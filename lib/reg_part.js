/**
 * @fileOverview  一些常用正则片段.
 * @author liesun.wjb@taobao.com
 * @since  2014.04.11
 */

'use strict';
 
var space = '\\s*';
var variable = '(?:\\$\\w+)';
var number = '(?:\\d+(?:\\.\\d+)?)';
var Const  = '(?:true|false|undefined|null)';
var string = ( //单引号或双引号括起的字符串，用\x表示转义
     '(?:'           
   +     '"(?:[^"\\\\]|\\\\.)*?"'       
   +    "|'(?:[^'\\\\]|\\\\.)*?'"       
   + ')' 
);

var exprElem = '(?:' + string + '|' + number + '|' + variable + '|' + Const + ')';
var mathSymb = '[-+*/%]';
var compSymb = (
     '(?:'//注意：?=和!= 是正则中的元字符因此需要转义
   +     ['\\!=', '>=', '<=', '==', '>', '<'].join('|')     
   + ')'
);

// 定义算术表达式、比较表达式、三目运算表达式
var mathExpr = '(?:' + exprElem + '(?:' + space + mathSymb + space + exprElem + ')*)';
var compExpr = '(?:' + mathExpr + space + compSymb + space + mathExpr + ')';
var ternaryExpr = (
      '(?:'
    +   compExpr
    +   space + '\\?' + space
    +   mathExpr
    +   space + ':'   + space
    +   mathExpr
    + ')'
);

var express = ( // 优先匹配较长的表达式
      '(?:'
    +   ternaryExpr 
    +   '|' + compExpr
    +   '|' + mathExpr
    + ')'
); 
 
var keyValPair = (
     '(?:'
   +    '[-$\\w]+'       
   +    '\\s*=\\s*'     
   +    string
   + ')'
); 
 
module.exports = {
   keyValPair : keyValPair,
   variable : variable,
   number   : number,
   string   : string,
   express  : express
};