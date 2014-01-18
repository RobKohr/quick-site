/*
Socket site sets up a really quick express/socket.io site. Everything comes from the 
home directory, and templates are loaded based on path.
*/
var pruneJSON = require('JSON.prune/JSON.prune.js');
var multiparty = require('multiparty');
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
    initControllers();
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
	db.insertFlow = function(collection, object, req, res, next){
	    req.db.collection(collection).insert(object, function(err, docs){
		try{
		    if((docs) && (docs[0]) && (obj = docs[0])){
			obj._id = obj._id.toString();
			res.data.created = obj;
			res.data.success=true;
		    }else{
			return next();
			res.data.errors.push('error creating '+collection);
			res.data.success=false;
			res.data.err = err;
		    }
		}catch(E){
		    return next();
		}
		return next();
	    });
	};

	
	db.findFlow = function(collection, query_or_params, req, res, next){
	    if(query_or_params.query){
		var query = query_or_params.query;
		var fields = query_or_params.fields;
	    }else{
		var query = query_or_params;
		var fields = null;
	    }
	    if(query._id){
		query._id = req.db.ObjectID(query._id);
	    }
	    req.db.collection(collection).find(query, fields).toArray(function(err, objs){
		res.data.success=true;;
		if(err){
		    res.data.success=false;
		    res.data.collection = collection;
		    res.data.query = query;
		}
		res.data.found = objs;
		return next();
	    });
	}

	db.findOneFlow = function(collection, query, req, res, next){
	    if(query._id){
		query._id = req.db.ObjectID(query._id);
	    }
	    req.db.collection(collection).findOne(query, function(err, obj){
		if(obj){
		    obj._id = obj._id.toString();
		    res.data.found = obj;
		    res.data.success=true;
		}else{
		    res.data.err = err;
		    res.data.collection = collection;
		    res.data.query = query;
		    res.data.testtt = typeof(query._id);
		    res.data.success=false;
		}
		return next();
	    })
	}
	
    })
    console.log('config:', config);
    app.use(express.bodyParser({uploadDir:config.cwd+'/uploads'}));
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
function initControllers(){
    
    console.log('config:', config);
    var dirs = fs.readdirSync(config.src);
    var controller_list = [];
    for(var i in dirs){
	var path = config.src+'/'+dirs[i];

	if(fs.lstatSync(path).isDirectory()){
	    var controller_path = path+'/'+dirs[i]+'_controller.js';
	    if(fs.existsSync(controller_path)){
		controller_list.push(dirs[i]);
		var c = controllers[dirs[i]] = require(controller_path);
	    }
	}
    }
    console.log('Controller List: ', controller_list);
}


function controller(req, res, next){
    console.log('f controller');
    var bodyViewPath = req._parsedUrl.pathname.substr(1);
    var controller_name = bodyViewPath.split('/')[0];
    if(!controller_name){
	controller_name = 'home';
    }
    res.data.controller_name = controller_name;
    if(!controllers[controller_name]){
	res.data.controller_not_found=true;
	console.log('No controller found called ' + controller_name);
	return next();//there is no controller... just load up template
    }else{
	var c = controllers[controller_name];
	console.log('controller found')
	if(!c.initialized){
	    console.log('initializing controller');
	    c.init(req, function(){
		c.initialized = true;
		onControllerInit();
	    });
	}else{
	    console.log('Controller loaded before, continue.');
	    onControllerInit();
	}
    }
    function onControllerInit(){
	console.log('in f onControllerInit');
	method_name = bodyViewPath.split('/')[1];
	if(!method_name)
	    method_name = 'index';
	res.data.method_name = method_name;
	
	processForms(c, req, res, next, function callbackFromProcessForms(){
	    console.log('in f callbackFromProcessForms');
	    if(c[method_name]){
		console.log('controller method found');
		return c[method_name](req, res, next);
	    }else{
		console.log('no controller method found:'+method_name);
		return next();
	    }
	});
    }
}

function objLength(obj){
    var i = 0;
    for(var key in obj){
	i++;
    }
    return i;
}

function processForms(controller, req, res, next, callback){
    var form = req.param('form');
    console.log('in f ProcessForms'); 
    if(!form){
	console.log('form not set');
	if((objLength(req.query)) || (objLength(req.body))){
	    form = res.data.method_name;
	    console.log('form set to method: '+res.data.method_name);
	}else{
	    console.log('no form values... no form processing...');
	    return callback();
	}
    }
    if(controller.form && controller.form[form]){
	console.log('form exists, lets run it');
	controller.form[form](req, res, callback);
    }else{
	console.log('form doesnt exist... error');
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
    clearTimeout(req.timeout);
    if(req.rendered){
	console.log('Request already rendered?');
	return;
    }else{
	req.rendered = true;
    }
    console.log('====/Rendering Request===');
    if(req.param('output')=='json'){
	delete res.data.form;
	return res.send(res.data);
	var out = JSON.parse(pruneJSON(res.data));
	return res.send(out);
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
    console.log('=======New Request======');
    console.log(new Date());
    var data = {};
    req.db = db;
    data.form = require('quick-forms');
    data.form.req = req;    
    req.connection.setTimeout(10000);
    req.config = config;
    res.data = data;    
    res.data.session = req.session;
    res.data.errors = [];
    res.data.notices = [];
    req.timeout = setTimeout(function(){ res.data.errors.push('Request timeout, forced render'); render(req, res, next) }, 9000);
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


