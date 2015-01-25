var browserify = require("browserify");
var b = browserify();
var fs = require("fs");

b.add('./src/measure.js');
b.add('./src/musicxml.js');
b.add('./src/document.js');
b.add('./src/documentformatter.js');

b.bundle().pipe(fs.createWriteStream("vexflow.musicxml.js"));