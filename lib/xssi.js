/**
 * @fileOverview 对jayli-sever的ssi功能做了一些
 * 增强，为include添加了重复功能和简单变量插入功能.
 * @author  liesun.wjb@taobao.com
 * @since   2014.04.10
 */

'use strict';

var fs = require('fs');
var pwd = process.cwd();
var path = require('path');
var iconv = require('iconv-lite');
var isUtf8 = require('./is-utf8');
var regPart= require('./reg_part');

var COLOR_RED    = '\u001b[31m';
var COLOR_GRAY   = '\u001b[37m';
var COLOR_BLUE   = '\u001b[34m';
var COLOR_CYAN   = "\u001B[36m";
var COLOR_GREEN  = '\u001b[32m';
var COLOR_RESET  = '\u001b[0m';
var COLOR_YELLOW = '\u001b[33m';
var COLOR_PURPLE = "\u001B[35m";

/**
 * 读取文件内容并返回utf-8格式文本.
 * @author bachi@taobao.com, liesun.wjb@taobao.com
 * @param  {String}file
 * @return {String}
 * @private
 */
function read(file){
	var fd = fs.readFileSync(file);
    var bf = isUtf8(fd)
           ? fs.readFileSync(file)
           : iconv.encode(iconv.decode(fd, 'gbk'),'utf8');
    
    return bf.toString();
}

/**
 * 以彩色文字形式显示错误信息.
 * @param {String}cont
 * @private
 */
function showError(cont){
    console.log(
        '%s[Error] %s%s  %s',
        COLOR_RED, 
        COLOR_CYAN, 
        cont, 
        COLOR_RESET
    );
}

/**
 * 将tag中的属性设置解析为json.
 * @prama   {String}str
 * @return  {JSON}
 * @private
 */
function parse_tag_props(str){
    var reg  = new RegExp(regPart.keyValPair, 'g');
    var boolConst = ['true', 'false', 'null', 'undefined'];
    var list = str.match(reg);
    var list = str.match(reg);
    var hasIncVars = false;
    var incVars = {};
    var ret  = {};
    
    list.forEach(function(i){        
        var d = i.split(/\s*=\s*/);
        var v = d[1].replace(/^['"]|['"]$/g, '');
        var k = d[0];       

        v = (
              !isNaN(v) ? Number(v)
            : boolConst.indexOf(v) != -1 ? Boolean(v)
            : v
        );

        //将以$开头的属性视为include文件中可以使用的变量
        if(k.charAt(0) == '$'){
            hasIncVars = true;
            incVars[k.slice(1)] = v;
        }else{
            ret[k] = v;
        }
    });
    
    if(hasIncVars){ 
        ret['inc-vars'] = incVars; 
    }

    return ret;
}

/**
 * 获取运行时环境信息.
 * @param  {JSON}cfg
 * @param  {JSON}parent
 * @return {JSON}
 * @private
 */
function get_context(cfg, parent){
    var htmlFile = cfg.htmlFile;
    var rootPath = pwd + '/src';
    var filePath = path.dirname(htmlFile);    

    var incProps = cfg.incProps ? parse_tag_props(cfg.incProps) : {};
    var incFile  = incProps.file || incProps.virtual;    
    
    var ignoreError = parent && parent.incProps.ignoreError == true ? true : false;
    var refLink = parent ? parent.refLink.concat(htmlFile) : [htmlFile];
    var insVars = parent ? parent.incProps['inc-vars'] : {};
    var readCache = parent ? parent.readCache : {};
    
    return {
        htmlFile  : htmlFile,
        rootPath  : rootPath,
        filePath  : filePath,
        
        incFile   : incFile,
        insVars   : insVars,
        incProps  : incProps,
        refLink   : refLink,
        readCache : readCache,
        ignoreError : ignoreError
    };
}

/**
 * 将include文件中格式为<%=...%>的表达式替换为运算结果.
 * @param  {String}expr
 * @param  {JSON}ctx
 * @param  {String}
 * @private
 */
function handle_insert(expr, ctx){
    var ingoreError = ctx.ignoreError;
    var insVars = ctx.insVars;
    var reg = new RegExp((
          '(' + regPart.string   + ')'
       + '|(' + regPart.variable + ')'        
    ), 'g');
    
    // 将表达式中的变量的$前缀替换为insVars+点，因为
    // 字符串中也有可能含有$, 因此为了避免误替换，也
    // 需要捕获字符串然后原样返回。
    var exprCont = expr.replace(reg, function(m, str, $var){
        if(str) { return str; }
        
        var varName = $var.slice(1);        
        if(insVars[varName] == null){
            showError('ssi.js#handle_insert: undefined variable :' + $var);
        }
            
        return 'insVars.' + varName;       
    });
    
    try{
        return eval('(' + exprCont + ')');
    }catch(e){
        showError('ssi.js#handle_insert: a error occured when eval express (' + expr + '), error: ' + e);
        return ingoreError ? '' : '__XSSI_ERROR__';
    }
}

/**
 * 处理格式为<!--#include ...-->的ssi插入.
 * @param  {JSON}ctx
 * @return {String}
 * @private
 * @example
 * 
 * 1. 路径
 * -------------------------------------------------
 * 通过file属性制定的路径若以"."或".."开头则视为相对
 * 路径，否则视为据对路径，当视为绝对路径时，以项目
 * 的src目录作为根目录. 所以上面的代码用绝对路径表示
 * 可以这样写：
 *    <!--include file="/page/foo/sub.html"-->
 * 或者
 *    <!--include file="page/foo/sub.html"-->
 *
 * 2. 重复
 * -----------------------------------------------
 * 可以通过repeat参数来指定重复次数比如:
 *    <!--#include file="../sub.html" repeat="5" -->
 *
 * 3. 简单变量插入
 * ------------------------------------------------
 * 可以通过添加以$开头的属性指定插入文件中可以使用的变量，比如：
 *    <!--#include file="../sub.html" repeat="5"
 *        $name="zhang-san" 
 *        $gender="f"
 *        $age="20" 
 *        --> 
 *
 * 那么sub.html就可以以如下格式使用这些变量:
 *    index  : <%=$__index__ + 1%>
 *    colum  : <%=$__index__ % 3%>
 *    total  : <%=$__count__%>
 *    gender : <%=$gender == 'f' ? '男' : '女' %>
 *    name   : <%=$name%>
 *    age    : <%=$age%> 
 * 
 * 上面的例子中有两个变量:$__count__、$__index__,
 * 这两个变量是系统自动添加进去的，分别代表文件被
 * 重复的次数以及当前重复索引(以0为起始）.
 * 
 *  在使用简单变量插入功能时可以使用如下运算符:
 *     +  -  *  /  %  >=  <=  !=  >  <  ?:
 *  注意： 不支持括号，不支持多个三目运算符的嵌套. 
 * 
 * 注意: 在本程序中凡是以双下划线* "__"开头的变量名都
 * 是系统自动注入的，在inc-vars中不要使用这样变量名，
 * 否则有可能会被覆盖掉.
 */
function handle_ssi(ctx){
    var i, len, ret, fileCont, incVars, absPath;
    var incFile  = ctx.incFile;
    var incProps = ctx.incProps;
    var filePath = ctx.filePath;
    var rootPath = ctx.rootPath;
    var refLink  = ctx.refLink;
    var cache = ctx.readCache;
    
    //若为http地址, 交给chunk.js去处理
    if(incFile.indexOf('http://') != -1){
        return '--#chunk url="' + incFile.replace(/\\/g, '/') + '"--';
    }
    
    absPath = (
          incFile.indexOf('./') == 0 || incFile.indexOf('../') == 0
        ? path.resolve(filePath + '/' + incFile)
        : path.resolve(rootPath + '/' + incFile) 
    );
    
    //检测引用的文件是否存在
    if(!fs.existsSync(absPath)){
        return '<!-- the file "' + incFile + '" is not found! -->';
    }
    
    //检测是否存在循环依赖
    if(refLink.indexOf(absPath) != -1){
        throw (
             'ssi#handle_ssi: circular reference exists: \n' 
           + '\t' + refLink.concat(absPath).join('\n\t↓\n\t')
        );
    }
    
    //读取include文件内容
    fileCont = (
        cache[absPath] ? cache[absPath] : 
        cache[absPath] = read(absPath)
    );
    
    //替换include文字中的变量，若制定了重复次数，重复内容
    incVars = (
        incProps['inc-vars'] ?
        incProps['inc-vars'] :
        incProps['inc-vars'] = {}
    );    
    
    if(incProps.repeat && incProps.repeat > 0){ 
        len = incProps.repeat;        
        
        for(i=0, ret=[]; i < len; i++){
            incVars.__count__ = len;
            incVars.__index__ = i; 
            ret.push(parseContent(
                absPath, fileCont, ctx
            ));
        }
        
        ret = ret.join('\n\n');
    }else{
        incVars.__count__ = 1;
        incVars.__index__ = 0;     
        ret = parseContent(absPath, fileCont, ctx)
    }

    return ret;
}

/**
 * 解析页面中的变量插入和include并将解析后的结果返回.
 * @param  {String}htmlFile
 * @param  {String}cont
 * @param  {JSON}ctx
 * @return {String}
 * @public
 */
function parseContent(htmlFile, cont, parentCtx){
    var val_insert = (
          '<%=\\s*' 
        +   '(' + regPart.express + ')' 
        + '\\s*%>'
    );
            
    var include = (
          '<!--\\s*#include'                    //include指令开始标记
        +   '((?:[\\s]+' + regPart.keyValPair + ')+?)'  //属性设置部分
        + '\\s*-->'                             //include指令结束标记
    );

	cont = awpp_replacement(cont);

    var repReg = new RegExp((val_insert + '|' + include), 'g');
        
    return cont.replace(repReg, function(m, expr, incProps){        
        var ctx = get_context({
            htmlFile: htmlFile,
            incProps: incProps
        }, parentCtx);        

        if(expr){
            return handle_insert(expr, ctx);
        }else{
            return handle_ssi(ctx);
        }
    });
}

// 将<!--HTTP:xxx,utf8:HTTP-->和<!--TMS:xxx,utf-8:TMS-->替换为<!--#include path="..." -->
function awpp_replacement(cont){
	var awpp_include = '<!--HTTP:([^,]+),(utf-8|utf8|gbk|gb2312):HTTP-->';
	var awpp_include_nake = '<!--HTTP:([^,]+):HTTP-->';

	cont = cont.replace(new RegExp(awpp_include,'ig'),function(){
		var args = arguments;
		return "<!--#include " + 'virtual="' + args[1] + '" -->';
	});
	cont = cont.replace(new RegExp(awpp_include_nake,'ig'),function(){
		var args = arguments;
		return "<!--#include " + 'virtual="' + args[1] + '" -->';
	});

	// 增加 <!--TMS--> 标签兼容解析，@弘树
	var tmsPrefix = 'trip.taobao.com/go/';
	var tms_include = '<!--TMS:([^,]+),(utf-8|utf8|gbk|gb2312),([0-9]*):TMS-->';
	cont = cont.replace(new RegExp(tms_include, 'ig'),function(matchPath, tmsPath, encoding, tmsdir){
		return "<!--#include " + 'virtual="http://' + path.join(tmsPrefix, tmsPath) + '" -->';
	});

	return cont;
}

exports.ssiChunk = parseContent;
