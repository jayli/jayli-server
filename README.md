# jayli

## Purpose

A node.js module for delivering static files.

## Current Status

This module is used by [tempalias.com](http://tempalias.com/) in production
and is mainted by [Felix Geisendörfer](https://github.com/felixge). However,
this one one of my first node modules and it lacks a test suite, you've been
warned : ).

## Features
  
 * Configurable callbacks on most events
 * ETag / 304 Support
 * Custom HTTP headers

## Example

Example from example/basic.js:

    var
      path = require('path'),
      http = require('http'),
      jayli = require('../lib/jayli'),
    
      PORT = 8003,
      WEBROOT = path.join(path.dirname(__filename), 'webroot');
    
    http.createServer(function(req, res) {
      var ip = req.connection.remoteAddress;
      jayli
        .deliver(WEBROOT, req, res)
        .addHeader('Expires', 300)
        .addHeader('X-PaperRoute', 'Node')
        .before(function() {
          console.log('Received Request');
        })
        .after(function(statCode, filepath, fileBuffer, encoding) {
          log(statCode, req.url, ip);
          return fileBuffer;
        })
        .error(function(statCode, msg) {
          res.writeHead(statCode, {'Content-Type': 'text/plain'});
          res.end("Error " + statCode);
          log(statCode, req.url, ip, msg);
        })
        .otherwise(function(err) {
          res.writeHead(404, {'Content-Type': 'text/plain'});
          res.end("Error 404: File not found");
          log(404, req.url, ip, err);
        });
    }).listen(PORT);
    
    function log(statCode, url, ip, err) {
      var logStr = statCode + ' - ' + url + ' - ' + ip;
      if (err)
        logStr += ' - ' + err;
      console.log(logStr);
    }

## API Docs

### ssi included
	
#### 代码样例    
    <!--#include path="asdf.html"  -->
    <!--#include file="../sub.html" repeat="5" -->
    <!--#include file="../sub.html" repeat="5"
        $name="zhang-san" 
        $gender="f"
        $age="20" 
        --> 

#### 使用说明        
##### 路径
-------------------------------------------------
    通过file或属性制定的路径若以"."或".."开头则视为相对
    路径，否则视为据对路径，当视为绝对路径时，以项目
    的src目录作为根目录. 所以上面的代码用绝对路径表示
    可以这样写：
       <!--include file="/page/foo/sub.html"-->
    或者
       <!--include file="page/foo/sub.html"-->
    
##### 重复
-----------------------------------------------
    可以通过repeat参数来指定重复次数比如:
       <!--#include file="../sub.html" repeat="5" -->
    
##### 简单变量插入
------------------------------------------------
    可以通过添加以$开头的属性指定插入文件中可以使用的变量，比如：
       <!--#include file="../sub.html" repeat="5"
           $name="zhang-san" 
           $gender="f"
           $age="20" 
           --> 
    
    那么sub.html就可以以如下格式使用这些变量:
       index  : <%=$__index__ + 1%>
       colum  : <%=$__index__ % 3%>
       total  : <%=$__count__%>
       gender : <%=$gender == 'f' ? '男' : '女' %>
       name   : <%=$name%>
       age    : <%=$age%> 
    
    上面的例子中有两个变量:$__count__、$__index__,
    这两个变量是系统自动添加进去的，分别代表文件被
    重复的次数以及当前重复索引(以0为起始）.
    
     在使用简单变量插入功能时可以使用如下运算符:
        +  -  *  /  %  >=  <=  !=  >  <  ?:
     注意： 不支持括号，不支持多个三目运算符的嵌套. 
    
    注意: 在本程序中凡是以双下划线* "__"开头的变量名都
    是系统自动注入的，在inc-vars中不要使用这样变量名，
    否则有可能会被覆盖掉.

### mockdata

src html file include juicer template and mock data

source file

	<!--#ef
	{
		"list": [
			1,2,3,4
		]
	}
	-->
	<ul>
		{@each list as it,index}
			<li>${it.name} (index: ${index})</li>
		{@/each}
		{@each blah as it}
			<li>
				num: ${it.num} <br />
				{@if it.num==3}
					{@each it.inner as it2}
						${it2.time} <br />
					{@/each}
				{@/if}
			</li>
		{@/each}
	</ul>

output

	<ul>
		<li>(index: 0)</li>
		<li>(index: 1)</li>
		<li>(index: 2)</li>
		<li>(index: 3)</li>
	</ul>

### PHP support

PHP file is ok。get url query string:

	if(isset($argv)){
		$_GET = (array)(json_decode($argv[2]));
	}
	echo $_GET['a'];

### jayli.deliver(webroot, req, res)

Checks the `webroot` folder if it has a file that matches the `req.url` and streams it to the client. If `req.url` ends with a '/' (slash), 'index.html' is appended automatically.

Parameters:

* `webroot`: Absolute path where too look for static files to serve
* `req`: A `http.ServerRequest` object
* `res`: A `http.ServerResponse` object

This returns an object with several functions that you can call, to modify how the static content is delivered. Each of these functions returns the object, so you can chain them, as shown in the example above. They each take a callback function, whose arguments and expected behavior are detailed below.

#### before(callback())

Fires if a matching file was found in the `webroot` and is about to be delivered. The delivery can be canceled by returning `false` from within the callback.

#### after(callback(statCode, filepath, fileBuffer, encoding))

Fires after a file has been successfully delivered from the `webroot`. `statCode` contains the numeric HTTP status code that was sent to the client. You must close the connection yourself if the error callback fires!

> after 回调现已支持将文件 Buffer 对外暴露出来，从而进行按需处理（如替换页面引入的静态资源、修改 DOM 等）之后再响应回客户端。
> 
> 参数:
> 	- statCode: 状态码；
> 	- filepath: 文件路径；
> 	- fileBuffer: 文件Buffer；
> 	- encoding: 文件编码


#### error(callback(statCode, msg))

Fires if there was an error delivering a file from the `webroot`. `statCode` contains the numeric HTTP status code that was sent to the client. `msg` contains the error message. You must close the connection yourself if the error callback fires! The default callback shows a minimal HTTP error page.

#### otherwise(callback(err))

Fires if no matching file was found in the `webroot`. Also fires if `false` was returned in the `delegate.before()` callback. If there was a problem stating the file, `err` is set to the contents of that error message. The default callback shows a simple "HTTP 404 File Not Found" page.

#### addHeader(callback(name, value))

Sets an arbitrary HTTP header. The header name `Expires` is special and expects the number of milliseconds till expiry, from which it will calculate the proper HTTP date.

## License

jayli is licensed under the MIT license.

## Credits

* [Jan Lehnardt](http://twitter.com/janl) for coming up with the name "jayli"
