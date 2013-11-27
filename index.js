 /*
Socket site sets up a really quick express/socket.io site. Everything comes from the 
home directory, and templates are loaded based on path.
*/
var config = {port:80, src:'src/'};
var express = require('express');
var MongoStore = require('express-session-mongo');
var expressValidator = require('express-validator');
var form = require('quick-forms');
var app = express()
, server = require('http').createServer(app)
, io = require('socket.io').listen(server, { log: false });
var ejs = require('ejs');
var MongoClient = require('mongodb').MongoClient
, format = require('util').format;
var ObjectID = require('mongodb').ObjectID;
var db = null;


exports.init = function(c){
    if(c){
	for(var key in c){
	    config[key] = c[key];
	}
    }
    MongoClient.connect('mongodb://127.0.0.1:27017/'+c.database, function(err, ldb) {
	if(err) throw err;
	db = ldb;//put this db reference on the global scope
	db.ObjectID = function(str){
	    if(typeof(str)=='object'){
		return str;//ObjectID passed in
	    }
	    try{
		return ObjectID(str);
	    }catch(E){
		return null;//typically an invalid formatted object id
	    }
	}
    })

    console.log('config:', config);
    app.use(express.bodyParser());

    app.use(expressValidator([]));
    app.set('views', config.src);

    app.use(express.cookieParser());
    var m_conf = {db:config.database};
    app.use(express.session({store:new MongoStore(m_conf), secret:config.secret}));

    app.use(express.static(config.src));
    app.set('view engine', "ejs");
    
    app.engine('ejs', ejs.__express);
    app.all("*", resSetup, controller, render);
    app.listen(config.port);

    io.sockets.on('connection', function (socket) {
	socket.on('msg', function (data) {
	    io.sockets.emit('new', data);
	});
    });
}

var controllers = {};
var fs = require('fs');

function controller(req, res, next){
    var bodyViewPath = req._parsedUrl.pathname.substr(1);
    var controller_name = bodyViewPath.split('/')[0];
    if(!controller_name){
	controller_name = 'home';
    }
    res.data.controller_name = controller_name;
    if(!controllers[controller_name]){
	var controller_path = config.src + '/' + controller_name + '/'+controller_name+'_controller.js';
	if (!(fs.existsSync(controller_path))) {
	    return next();//there is no controller... just load up template
	}
	controllers[controller_name] = require(controller_path);
	var c = controllers[controller_name];
	c.init(req, onControllerInit);
    }else{
	var c = controllers[controller_name];
	onControllerInit();
    }

    function onControllerInit(){
	processForms(c, req, res, next, function callbackFromProcessForms(){
	    method_name = bodyViewPath.split('/')[1];
	    if(!method_name)
		method_name = 'index';
	    res.data.method_name = method_name;
	    if(c[method_name]){
		return c[method_name](req, res, next);
	    }else{
		return next();
	    }
	});
    }
}

function processForms(controller, req, res, next, callback){
     var form = req.param('form');
     if(!form){
	 return callback();
     }
     if(controller.form && controller.form[form]){
	 controller.form[form](req, res, callback);
     }else{
	 res.data.errors.push('No form processor for '+form);
	 return callback();
    }
};


function err403(req, res){
    return res.send(403, "Forbidden");
}
function err404(req, res){
    return res.send(404, "File not found");
}


render = function(req, res, next){
    if(req.param('output')=='json'){
	return res.send(JSON.stringify(res.data, null, '  '));
    }
    if(config.template_helpers){
	for(var key in config.template_helpers){
	    res.data[key] = config.template_helpers[key];
	}
    }
    if(req._parsedUrl){
	res.data.req  = req;
	var bodyViewPath = req._parsedUrl.pathname.substr(1);
	bodyViewPath = bodyViewPath.split('/').slice(0,2).join('/');
	if(res.data.body_template)
	    bodyViewPath = res.data.body_template;
	var controller_name = bodyViewPath.split('/')[0];
	header = controller_name+'/header';
	var sections = [
	    'templates/layout_top',
	    controller_name+'/header',
	    bodyViewPath,
	    'templates/layout_bottom'
	];
	var buildSections = function(out, sections){
	    if(!(sections.length)){
		//no more sections to render, send output...
		return res.send(out);
	    }
	    var sectionPath = sections.shift();
	    app.render(sectionPath, res.data, function(err, moreOut){
		if(!err){
		    out += moreOut;
		}
		return buildSections(out, sections);
	    });
	};
	buildSections('', sections);
    }
};

resSetup = function(req, res, next){
    var data = {};
    req.db = db;
    data.form = require('quick-forms');
    data.form.req = req;
    req.connection.setTimeout(1000);
    res.data = data;    
    res.data.session = req.session;
    res.data.errors = [];
    res.data.notices = [];
    if(req.param('notice')){
	res.data.notices.push(req.param('notice'));
    }
    var bodyViewPath = req._parsedUrl.pathname.substr(1);
    req.url_params = bodyViewPath.split('/').slice(2);


    data.project_name = config.project_name;
    req.hasErrors = function(req, res){
	if(req.validationErrors()){
	    res.data.errors = res.data.errors.concat(req.validationErrors());
	    return true;
	}
	if(res.data.errors.length){
	    return true;
	}
	return false;
    }    
    return next();
}


