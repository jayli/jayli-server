var
  ssiChunk = require('./xssi').ssiChunk,
  events = require('events'),
  fs = require('fs'),
  url = require('url'),
  querystring = require('querystring'),
  chunkParser = require('./chunk').parse,
  path = require('path');

var isUtf8 = require('./is-utf8');
var tidy = require('./tidy.js');
var mock = require('./mock.js');
var iconv = require('iconv-lite');
var Juicer = require("juicer");
var php = require('php-template');
var joinbuffers = require('joinbuffers');
Juicer.register('stringify', JSON.stringify);

var BUFFER_SIZE = 400 * 1024;

/**
 * 获取自定义配置
 * @param content
 * @param reg
 */
function parseParam(content, reg) {
  var marched = content.match(reg);
  var ret = {};
  if (marched && marched[1]) {
    marched[1].replace(/[\n\r]/g, '');
    try {
      ret = JSON.parse(marched[1]);
    } catch (e) {
      console.log('格式错误的模板变量:%s', marched[1]);
      return {};
    }
    return ret;
  }
  return ret;
}

function parsePageParam(content) {
  return parseParam(content, /<\!--#def([\s\S]*?)-->/);
}

function delPageParamArea(content) {
  return content.replace(/<\!--#def([\s\S]*?)-->/, '');
}

exports.filepath = function (webroot, url) {
  webroot = path.resolve(webroot || '.');
  var pathSep = process.platform == 'win32' ? '\\' : '/';
  // Unescape URL to prevent security holes
  url = decodeURIComponent(url);
  // Strip nullbytes (they can make us believe that the file extension isn't the one it really is)
  url = url.replace(/\0/g, '');
  // Append index.html if path ends with '/'
  var fp = path.normalize(path.join(webroot, (url.match(/\/$/) == '/') ? url + 'index.html' : url));
  // Sanitize input, make sure people can't use .. to get above webroot
  if (webroot[webroot.length - 1] !== pathSep) webroot += pathSep;
  if (fp.substr(0, webroot.length) != webroot)
    return (['Permission Denied', null]);
  else
    return ([null, fp.replace('/', pathSep)]);
};


exports.streamFile = function (filepath, headerFields, stat, res, req) {
  var
    emitter = new events.EventEmitter(),
    extension = filepath.split('.').pop(),
    contentType = exports.contentTypes[extension] || 'application/octet-stream',
    charset = exports.charsets[contentType];

  process.nextTick(function () {
    if (charset)
      contentType += '; charset=' + charset;
    headerFields['Content-Type'] = contentType;

    var etag = '"' + stat.ino + '-' + stat.size + '-' + Date.parse(stat.mtime) + '"';
    headerFields['ETag'] = etag;

    // last-modified date should be present along with etag
    // also in a client-side JavaScript, document.lastModified uses this header value
    headerFields['Last-Modified'] = new Date(stat.mtime);

    var statCode;
    //Check to see if we can send a 304 and skip the send
    if (req.headers['if-none-match'] == etag && !/(html|shtml|php|xhtml|htm)/i.test(extension)) {
      statCode = 304;
      headerFields['Content-Length'] = 0;
    } else {
      // headerFields['Content-Length'] = stat.size;
      statCode = 200;
      if (headerFields['Expires'] != undefined) {
        var expires = new Date;
        expires.setTime(expires.getTime() + headerFields['Expires']);
        headerFields['Expires'] = expires.toUTCString();
      }
    }


    //If we sent a 304, skip sending a body
    if (statCode == 304 || req.method === 'HEAD') {
      res.writeHead(statCode, headerFields);
      res.end();
      emitter.emit("success", statCode);
    }
    else {

      var fileBuffer = [],
        encoding;

      fs.createReadStream(filepath, {
        'flags': 'r',
        'mode': 0666, 'bufferSize': BUFFER_SIZE
      })
        .addListener("data", function (chunk) {
          encoding = 'binary';
          var isPHP = /php/i.test(path.extname(filepath));
          if (/(html|shtml|php|xhtml|htm)/i.test(path.extname(filepath))) {
            encoding = isUtf8(chunk) ? 'utf8' : 'gbk';
            if (encoding == 'gbk') {
              chunk = iconv.encode(iconv.decode(chunk, 'gbk'), 'utf8');
            }

            chunk = ssiChunk(filepath, chunk.toString('utf8'));

            if (isPHP) {
              var tf = generatorTmpFile(filepath, chunk);
              var urlObj = querystring.parse(url.parse(req.url).query);
              php(tf, urlObj, function (err, response) { /* ... */
                fs.unlinkSync(tf);
                if (err) {
                  chunk = '' + err;
                  chunk = teardownChunk(chunk, encoding);
                  doResponse(res, chunk, headerFields, encoding, 500);
                } else {
                  chunk = response;
                  chunk = mockFilter(chunk);
                  chunk = teardownChunk(chunk, encoding);

                  fileBuffer.push(chunk);
                  //doResponse(res, chunk, headerFields, encoding, statCode);
                }
              });
            } else {
              // Mock 数据解析
              chunk = mockFilter(chunk);
              chunk = teardownChunk(chunk, encoding);

              fileBuffer.push(chunk);
              //doResponse(res, chunk, headerFields, encoding, statCode);
            }

          } else {
            res.writeHead(statCode, headerFields);
            fileBuffer.push(chunk);
            //res.write(chunk, encoding);
          }
        })
        .addListener("end", function () {
          res.writeHead(statCode, headerFields);
          emitter.emit("success", {
            statCode: statCode,
            fileBuffer: joinbuffers(fileBuffer),
            headerFields: headerFields,
            encoding: encoding
          });
        })
        .addListener("close", function () {
          res.writeHead(statCode, headerFields);
          setTimeout(function () {
            res.end();
          }, 4000);
        })
        .addListener("error", function (e) {
          res.writeHead(statCode, headerFields);
          emitter.emit("error", 500, e);
        });
    }
  });
  return emitter;
};

exports.deliver = function (webroot, req, res, filepath) {
  var
    stream,
    fpRes = exports.filepath(webroot, url.parse(req.url).pathname),
    fpErr = fpRes[0],
  // filepath = fpRes[1],
    beforeCallback,
    afterCallback,
    otherwiseCallback,
    errorCallback,
    headerFields = {},
    addHeaderCallback,
    delegate = {
      error: function (callback) {
        errorCallback = callback;
        return delegate;
      },
      before: function (callback) {
        beforeCallback = callback;
        return delegate;
      },
      after: function (callback) {
        afterCallback = callback;
        return delegate;
      },
      otherwise: function (callback) {
        otherwiseCallback = callback;
        return delegate;
      },
      addHeader: function (name, value) {
        headerFields[name] = value;
        return delegate;
      }
    };

  process.nextTick(function () {
    // Create default error and otherwise callbacks if none were given.
    errorCallback = errorCallback || function (statCode) {
        res.writeHead(statCode, {'Content-Type': 'text/html'});
        res.end("<h1>HTTP " + statCode + "</h1>");
      };
    otherwiseCallback = otherwiseCallback || function () {
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("<h1>HTTP 404 File not found</h1>");
      };

    //If file is in a directory outside of the webroot, deny the request
    if (fpErr) {
      statCode = 403;
      if (beforeCallback)
        beforeCallback();
      errorCallback(403, 'Forbidden');
    }
    else {
      fs.stat(filepath, function (err, stat) {
        if ((err || !stat.isFile())) {
          var exactErr = err || 'File not found';
          if (beforeCallback)
            beforeCallback();
          if (otherwiseCallback)
            otherwiseCallback(exactErr);
        } else {
          //The before callback can abort the transfer by returning false
          var cancel = beforeCallback && (beforeCallback() === false);
          if (cancel && otherwiseCallback) {
            otherwiseCallback();
          }
          else {
            stream = exports.streamFile(filepath, headerFields, stat, res, req);

            if (afterCallback) {
              stream.addListener("success", function (data) {

                var statCode = data.statCode,
                  fileBuffer = data.fileBuffer,
                  encoding = data.encoding,
                  headerFields = data.headerFields;

                // 调用配置的回调，将调用者的处理结果返回
                var fileProcResult = afterCallback(statCode, filepath, fileBuffer, encoding);
                // 如果afterCallback 返回 null，处理一下
                fileProcResult = fileProcResult || fileBuffer;

                // 输出响应
                doResponse(res, fileProcResult, headerFields, encoding, statCode);
              });
            }
            if (errorCallback) {
              stream.addListener("error", errorCallback);
            }
          }
        }
      });
    }
  });

  return delegate;
};

exports.contentTypes = {
  "aiff": "audio/x-aiff",
  "arj": "application/x-arj-compressed",
  "asf": "video/x-ms-asf",
  "asx": "video/x-ms-asx",
  "au": "audio/ulaw",
  "avi": "video/x-msvideo",
  "bcpio": "application/x-bcpio",
  "ccad": "application/clariscad",
  "cod": "application/vnd.rim.cod",
  "com": "application/x-msdos-program",
  "cpio": "application/x-cpio",
  "cpt": "application/mac-compactpro",
  "csh": "application/x-csh",
  "css": "text/css",
  "cur": "image/vnd.microsoft.icon",
  "deb": "application/x-debian-package",
  "dl": "video/dl",
  "doc": "application/msword",
  "drw": "application/drafting",
  "dvi": "application/x-dvi",
  "dwg": "application/acad",
  "dxf": "application/dxf",
  "dxr": "application/x-director",
  "etx": "text/x-setext",
  "ez": "application/andrew-inset",
  "fli": "video/x-fli",
  "flv": "video/x-flv",
  "gif": "image/gif",
  "gl": "video/gl",
  "gtar": "application/x-gtar",
  "gz": "application/x-gzip",
  "hdf": "application/x-hdf",
  "hqx": "application/mac-binhex40",
  "htm": "text/html",
  "html": "text/html",
  "ice": "x-conference/x-cooltalk",
  "ico": "image/x-icon",
  "ief": "image/ief",
  "igs": "model/iges",
  "ips": "application/x-ipscript",
  "ipx": "application/x-ipix",
  "jad": "text/vnd.sun.j2me.app-descriptor",
  "jar": "application/java-archive",
  "jpeg": "image/jpeg",
  "jpg": "image/jpeg",
  "js": "text/javascript",
  "json": "application/json",
  "latex": "application/x-latex",
  "lsp": "application/x-lisp",
  "lzh": "application/octet-stream",
  "m": "text/plain",
  "m3u": "audio/x-mpegurl",
  "man": "application/x-troff-man",
  "manifest": "text/cache-manifest",
  "me": "application/x-troff-me",
  "midi": "audio/midi",
  "mif": "application/x-mif",
  "mime": "www/mime",
  "movie": "video/x-sgi-movie",
  "mp4": "video/mp4",
  "mpg": "video/mpeg",
  "mpga": "audio/mpeg",
  "ms": "application/x-troff-ms",
  "nc": "application/x-netcdf",
  "oda": "application/oda",
  "ogm": "application/ogg",
  "pbm": "image/x-portable-bitmap",
  "pdf": "application/pdf",
  "pgm": "image/x-portable-graymap",
  "pgn": "application/x-chess-pgn",
  "pgp": "application/pgp",
  "pm": "application/x-perl",
  "png": "image/png",
  "pnm": "image/x-portable-anymap",
  "ppm": "image/x-portable-pixmap",
  "ppz": "application/vnd.ms-powerpoint",
  "pre": "application/x-freelance",
  "prt": "application/pro_eng",
  "ps": "application/postscript",
  "qt": "video/quicktime",
  "ra": "audio/x-realaudio",
  "rar": "application/x-rar-compressed",
  "ras": "image/x-cmu-raster",
  "rgb": "image/x-rgb",
  "rm": "audio/x-pn-realaudio",
  "rpm": "audio/x-pn-realaudio-plugin",
  "rtf": "text/rtf",
  "rtx": "text/richtext",
  "scm": "application/x-lotusscreencam",
  "set": "application/set",
  "sgml": "text/sgml",
  "sh": "application/x-sh",
  "shar": "application/x-shar",
  "silo": "model/mesh",
  "sit": "application/x-stuffit",
  "skt": "application/x-koan",
  "smil": "application/smil",
  "snd": "audio/basic",
  "sol": "application/solids",
  "spl": "application/x-futuresplash",
  "src": "application/x-wais-source",
  "stl": "application/SLA",
  "stp": "application/STEP",
  "sv4cpio": "application/x-sv4cpio",
  "sv4crc": "application/x-sv4crc",
  "svg": "image/svg+xml",
  "swf": "application/x-shockwave-flash",
  "tar": "application/x-tar",
  "tcl": "application/x-tcl",
  "tex": "application/x-tex",
  "texinfo": "application/x-texinfo",
  "tgz": "application/x-tar-gz",
  "tiff": "image/tiff",
  "tr": "application/x-troff",
  "tsi": "audio/TSP-audio",
  "tsp": "application/dsptype",
  "tsv": "text/tab-separated-values",
  "txt": "text/plain",
  "unv": "application/i-deas",
  "ustar": "application/x-ustar",
  "vcd": "application/x-cdlink",
  "vda": "application/vda",
  "vivo": "video/vnd.vivo",
  "vrm": "x-world/x-vrml",
  "wav": "audio/x-wav",
  "wax": "audio/x-ms-wax",
  "wma": "audio/x-ms-wma",
  "wmv": "video/x-ms-wmv",
  "wmx": "video/x-ms-wmx",
  "wrl": "model/vrml",
  "wvx": "video/x-ms-wvx",
  "xbm": "image/x-xbitmap",
  "xlw": "application/vnd.ms-excel",
  "xml": "text/xml",
  "xpm": "image/x-xpixmap",
  "xwd": "image/x-xwindowdump",
  "xyz": "chemical/x-pdb",
  "zip": "application/zip",
  "php": "text/html",
  "less": "text/css",
  "scss": "text/css"
};

exports.charsets = {
  'text/javascript': 'UTF-8',
  'text/html': 'UTF-8'
};

// 一定是 utf8 的内容
function generatorTmpFile(filepath, data) {
  var tfn = filepath + '.' + Math.random().toString().replace('.', '');
  fs.writeFileSync(tfn, data, {
    encoding: 'utf8'
  });
  return tfn;
}

// 一定是utf8格式
function mockFilter(chunk) {
  if (mock.checkDef(chunk)) {
    var pageParam = mock.getMockData(chunk);
    chunk = Juicer(chunk, pageParam);
    // chunk = delPageParamArea(chunk);
    // tidy 对 行内script 中的注释支持有问题，暂时去掉
    // chunk = tidy(chunk);
  }
  return chunk;
}

// 传入的chunk一定是utf8的
function teardownChunk(chunk, encoding) {
  if (!(chunk instanceof Buffer)) {
    chunk = new Buffer(chunk);
  }
  if (encoding == 'gbk') {
    chunk = iconv.encode(iconv.decode(chunk, 'utf8'), 'gbk');
  }
  return chunk;
}

// chunk 一定是二进制的
function doResponse(res, chunk, headerFields, encoding, statCode) {
  headerFields['Content-Type'] = headerFields['Content-Type'].replace(/charset=(.+)$/i, 'charset=' + encoding);
  res.writeHead(statCode, headerFields);
  chunkParser(chunk, function (chunk) {
    chunk = teardownChunk(chunk, encoding);
    headerFields['Content-Length'] = chunk.length;
    res.write(chunk);
    res.end();
  });
}
