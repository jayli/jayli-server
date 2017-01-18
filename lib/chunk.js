// 'use strict';
var util = require('util');
var fs = require('fs');
var url = require('url');
var path = require('path');
var pwd = process.cwd();
var isUtf8 = require('./is-utf8');
var iconv = require('iconv-lite');
var http = require('http');
var joinbuffers = require('joinbuffers');
var Entities = require('html-entities').AllHtmlEntities;
entities = new Entities();

var reg = '--#(chunk)(\\s([a-z]+)=[\'"](.+?)[\'"])*--';

// p：绝对路径
// return:结果
function parseOne(chunk,callback){
	var chunk = parseChunk2String(chunk);
	var firstInclude = hasIncludes(chunk);
	//console.log(firstInclude);
	if(firstInclude){
		parseFirstIncludes(chunk,function(newchunk){
			parseOne(newchunk,callback);
		});
	} else {
		callback(chunk);
	}
}

function hasIncludes(chunk){
	var content = parseChunk2String(chunk);
	var r = content.match(new RegExp(reg,'i'));
	if(r){
		var f = RegExp.$4;
		return f;
	} else {
		return false;
	}
}

function parseFirstIncludes(content,callback){
	var content = parseChunk2String(content);
	var includefile = hasIncludes(content);
	var reqUrlObj = url.parse(('http://' + includefile).replace(/^http:\/\/http:\/\//i,'http://'), true);
	http.get(Object.assign(reqUrlObj, {
		headers: {
			referer: 'http://m.taobao.com'
		}
	}), function(res) {
		var buffs = [];
		res.on('data',function(chunk){
			buffs.push(chunk);
		}).on('end',function(){
      var buff = joinbuffers(buffs);
			if (/api\.alitrip\.com\/ems\/common/.test(includefile)) {
				buff = buff.toString('utf-8');
				buff = entities.decode(buff);
				var fn = 'var ' + reqUrlObj.query.callback + '=function(v){return v;};' + buff;
				var emsContent = eval(fn);
				buff = emsContent.toString().replace(/^function\s*\(\)\{\/\*|\*\/\}$/mg, '');
			}
			var newchunk = content.replace(new RegExp(reg,'i'),parseChunk2String(buff));
			callback(newchunk);
		});
		console.log("Got response: " + res.statusCode + ' '+ includefile);
	}).on('error', function(e) {
		console.log("Got error: " + e.message);
		callback('socket error');
	});
}

function parseChunk2String(content){
	if(!(content instanceof Buffer)){
		content = new Buffer(content);
	}
	encoding = isUtf8(content)?'utf8':'gbk';
	if(encoding == 'gbk'){
		content = iconv.encode(iconv.decode(content, 'gbk'),'utf8');
	}
	content = content.toString('utf8');
	return content;
}

exports.parse = parseOne;
