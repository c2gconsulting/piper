var db = require('./shared/lib/db');
var express = require('express');
var vhost = require('vhost');
var logger = require('./shared/lib/log');
var services = require('./servers.json').services;


var ERROR_RESPONSE_CODE = 422;
//var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');


//Create server and router
var app = express();
var router = express.Router();


app.use(function redirectHTTP(req, res, next) {
  	if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'].toLowerCase() === 'http') {
		return res.redirect('https://' + req.headers.host + req.url);
	}
  	next();
});


for (var i in services) {
	app.use(vhost(services[i].host, require(services[i].path + '/app').app));
}

// Setup healthcheck for LBs
app.all('/healthcheck', router); 

db.getModel('clients', function(err, model) {
	if (err) {
		logger.error('Fatal error: ' + err + '. Please resolve and restart the service');
	} else {
		Client = model;
	}	
});

router.get('/healthcheck', function(req, res) {
	Client.find({}, function (err, clients) {
		if (!err && clients && clients.length > 0){
			res.json(clients);
		} else if (!err) {
			res.end('No clients registered');
			logger.info('No clients registered');
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('There has been an error: ' + err);
			logger.error('There has been an error: ' + err);
		}
	});
});


//Start server
var port = process.env.PORT || 80;
app.listen( port, function() {
    logger.info( 'Piper server listening on port %d in %s mode', port, app.settings.env );
});




