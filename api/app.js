var fs = require('fs');
var db = require('../shared/lib/db');
var express = require('express');
var SlackConnection = require('./slackconnection');
var Log = require('log');
var ERROR_RESPONSE_CODE = 422;
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'server:';
var w = [];

// Create the Express application
var app = exports.app = express();

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();

// Initialize logger
var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');


/* 	Retrieve Models:
 * 	- slackconnections
 * 	- clients
 * 	- handlers
 */

db.getModel('handlers', function(err, model) {
    if (err) {
      // Unable to retrieve clients db object
      logger.error('Fatal error: ' + err + '. Please resolve and restart the service');
    } else {
      Handler = model;
    } 
 });

db.getModel('clients', function(err, model) {
	if (err) {
		// Unable to retrieve clients db object
		logger.error('Fatal error: ' + err + '. Please resolve and restart the service');

	} else {
		Client = model;
	}	
});

cache.del(CACHE_PREFIX + 'connections');

// Fire up connections ...
Client.find({'isActive': true }, function (err, clients) {
	if (!err && clients && clients.length > 0){
		for (var i in clients) {
			// Load clients in cache
			cache.hmset('client:' + clients[i]._id, '_id', clients[i]._id, 'slackHandle', clients[i].slackHandle, 'slackToken', clients[i].slackToken, 'adminContact', clients[i].adminContact, 'adminEmail', clients[i].adminEmail, 'isActive', clients[i].isActive);
			cache.hset('clients', clients[i].slackHandle, clients[i]._id);

			// Spawn slack connections
			createSlackConnection(clients[i]);
		}
	} else {
		logger.info('No clients currently registered or active, listening for new clients...');
	}
});


router.get('/register', function(req, res) {
	
	var name = req.query.name,
		slackHandle = req.query.handle,
		slackToken = req.query.token,
		adminContact = req.query.contact,
		adminEmail = req.query.email;

	var dataOk = true,
		invalidParam = '';

	if (!name) {
		dataOk = false;
		invalidParam = 'name';
	} else if (!slackHandle) {
		dataOk = false;
		invalidParam = 'slackHandle';
	} else if (!slackToken) {
		dataOk = false;
		invalidParam = 'slackToken';
	} else if (!adminContact) {
		dataOk = false;
		invalidParam = 'adminContact';
	} else if (!adminEmail) {
		dataOk = false;
		invalidParam = 'adminEmail';
	}

	if (dataOk) {
		if (registerClient({
	  		"name": name,
	  		"slackHandle": slackHandle,
	  		"slackToken": slackToken,
	  		"adminContact": adminContact,
	  		"adminEmail": adminEmail,
	  		"isActive": "True"
			})){
			res.end('Client ' + name + ' successfully registered and activated');
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Unable to register client ' + name);
		}
	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for ' + invalidParam);
	}
});


/* 
 *	Endpoints
 */
router.get('/connect', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(e, value) {
		if (!e && value) {
			cache.hgetall('client:' + value, function(err, client) {
				if (!err && client){
					if (createSlackConnection(client)) {
						res.json({status: 'Connected', client: client});
					} else {
						res.statusCode = ERROR_RESPONSE_CODE;
						res.end('Cannot create connection');
					}
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});


router.get('/disconnect', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(e, value) {
		if (!e && value) {
			cache.hgetall('client:' + value, function(err, client) {
				if (!err && client){
					if (removeSlackConnection(client)) {
						res.json({status: 'Disconnected', client: client});
					} else {
						res.statusCode = ERROR_RESPONSE_CODE;
						res.end('Client ' + slackHandle + ' does not have an active connection');
					}
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});


router.get('/getclient', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(err, value) {
		if (!err && value) {
			cache.hgetall('client:' + value, function(e, client) {
				if (!e && client) {
					res.json(client);
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});

router.get('/getclients', function(req, res) {
	Client.find({}, function (err, clients) {
		if (!err && clients && clients.length > 0){
			res.json(clients);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No clients registered');
			logger.info('No clients registered');
		}
	});
});


router.get('/getconnections', function(req, res) {
	cache.zrange(CACHE_PREFIX + 'connections', 0, -1, function(err, connections) {
		if (!err && connections && connections.length > 0){
			res.json(connections);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No connections active');
			logger.info('No connections active');
		}
	});

});


router.get('/sethandler', function(req, res) {
	var slackHandle = req.query.client;
	var state = req.query.state;
	var handler = req.query.handler;

	Handler.findOneAndUpdate(
		{slackHandle: slackHandle, state: state}, 
		{slackHandle: slackHandle, state: state, handler: handler, createdAt: new Date() }, 
		{upsert: true}, function (err) {
		if (err) {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Unable to create handler: ' + err);
			logger.error('Unable to create handler: ' + err);
		} else {
			res.end(handler + ' handler successfully registered for ' + slackHandle + ' and state: ' + state);
		}
	});
});


router.get('/gethandler', function(req, res) {
	var slackHandle = req.query.client;
	var state = req.query.state;
	
	Handler.findOne({slackHandle: slackHandle, state: state }, function (err, h) {
		if (!err && h){
			res.json(h);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No handler registered for ' + slackHandle + ' and state: ' + state);
			logger.info('No handler registered for ' + slackHandle + ' and state: ' + state);
		}
	});

});

// Register all our routes with /
app.use('/', router);


var createSlackConnection = function(client) {
	//console.log('in createSlackConnection: ' + client.slackHandle);
	if (!w[client._id]) {
		try {
			w[client._id] = new SlackConnection(client);
			
			
			// Update registry
			cache.zadd(CACHE_PREFIX + 'connections', new Date().getTime()/1000, client._id, function(err, conn) {
				logger.info('Registered connection for client: ' + client.slackHandle);
			});
			logger.info('Updating registry for client ' + client.slackHandle + '...');

			// Open connection
			//console.log('Client: ' + w[client._id].client.slackHandle);
			w[client._id].connect();


			// Listen for messages from connections
			w[client._id].on('open', function(cl){
				console.log('[Client: ' + cl._id + ' - ' + cl.name + '] Connection established...listening for messages');
			});

			w[client._id].on('message', function(user, message, cl){
				console.log('[Client: ' + cl._id + ' - ' + cl.name + '] Response dispatched to ' + user.name + ' for message: ' + message);
			});

			w[client._id].on('error', function(error, cl){
				console.log('[Client: ' + cl._id + ' - ' + cl.name + '] Error: ' + error);
				if (error === 'account_inactive') {
					console.log('[Client: ' + cl._id + ' - ' + cl.name + '] Removing connection... ')
					removeSlackConnection(cl);
				}
			});

			w[client._id].on('exit', function(cl){
				// remove from registry
				cache.zrem(CACHE_PREFIX + 'connections', cl._id);

		        //remove from array
		        delete w[cl._id];
		        console.log('[Client: ' + cl._id + ' - ' + cl.name + '] De-registering connection from registry...');
			});

			return true;
		} catch (e) {
			logger.error('Error in create slack connection: ' + e);
			return false;
		}

	} else {
		return false;
	}

}

var removeSlackConnection = function(client) {
	if (w[client._id]) {
		w[client._id].disconnect();
		return true;
	} else {
		return false;
	}
}		

var registerClient = function(client) {
	try {
		// Check if client already registered
		Client.findOne({ slackHandle:client.slackHandle }, function (err, newClient) {
			if (!err && newClient) {
				// client already exists - exit
				logger.info('Client ' + client.slackHandle + ' already registered');
			} else {
				var c = new Client(client);
				c.save(function(err) {
					if (err) {
						logger.error('Cannot register new client: ' + err);
					} else {
						logger.info('Client successfully registered, firing up slack worker...');
						Client.findOne({ slackHandle:client.slackHandle }, function (err, nc) {
							if (!err && nc) {
								// Newly created client - load in cache
								cache.hmset('client:' + nc._id, '_id', nc._id, 'slackHandle', nc.slackHandle, 'slackToken', nc.slackToken, 'adminContact', nc.adminContact, 'adminEmail', nc.adminEmail, 'isActive', nc.isActive);
								cache.hset('clients', nc.slackHandle, nc._id);

								createSlackConnection(nc);
							} else {
								logger.error('Error, unable to load client: ' + err);
							}
						});

					}
				});
			}
		});
		return true;
	} catch (e) {
		logger.error('Unable to register new client: ' + e);
		return false;
	}

}

