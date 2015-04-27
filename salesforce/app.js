
var db = require('../shared/lib/db');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var express = require('express');
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'piper-sales-handler:';
var ERROR_RESPONSE_CODE = 422;

// Create the Express application
var app = exports.app = express(); 
var router = express.Router(); // Create our Express router
app.use('/', router);

var pub = mq.context.socket('PUB', {routing: 'topic'});
var sub = mq.context.socket('SUB', {routing: 'topic'});
var msgid = new Date().getTime();

// subscribe to inbound MQ exchange
logger.info('SALES Handler: Connecting to MQ Exchange <piper.events.out>...');

/* 
 * Bind to all subscribed clients...
 *
db.getModel('sales_subscribers', function(err, model) {
	if (err) {
		logger.error('Fatal error: ' + err + '. Please resolve and restart the service'); // Unable to retrieve sales_subscribers db object
	} else {
		SalesSubscriber = model;
	}	
});

SalesSubscriber.find({}, function (err, subscribers) {
	if (!err && subscribers && subscribers.length > 0){
		for (var i in subscribers) {
			logger.info('SALES Handler <piper.events.out>: Binding to %s.sales...', subscribers[i].handle);
			sub.connect('piper.events.out', subscribers[i].handle + '.sales');
		}
	} else {
		logger.info('No subscribers currently registered or active, listening for new clients...');
	}
});

sub.on('data', function(data) {
	jsonData = JSON.parse(data);
	if (data) onMessage(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
});

var onMessage = function (id, user, client, body) {
	if (msgid !== id) {
		// ...
		push(user, client, { 'text': text });	
		msgid = id;
	}
}

/**
 * Push a message to the message exchange for a handler to pick up
 * @param user - user that owns this message
 * @param client - handle of the company that owns this message
 * @param body - JSON object with message to be processed by the handler
 *
 var push = function(user, client, body) {
	data = { 'id': new Date().getTime(), 'user': user, 'client': client, 'body': body };
	logger.info('SALES Handler: Connecting to MQ Exchange <piper.events.in>...');
	pub.connect('piper.events.in', function() {
		logger.info('SALES Handler:  MQ Exchange <piper.events.in> connected');
		pub.publish('sales', JSON.stringify(data));
	});
}

router.get('/subscribe', function(req, res) {	
	var handle = req.query.handle;

	if (handle) {
		if (subscribeClient(handle)){
			res.end('Client ' + handle + ' successfully subscribed and activated');
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Unable to subscribe client ' + handle);
		}
	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for handle');
	}
});

var subscribeClient = function(handle) {
	try {
		// Check if client already registered
		SalesSubscriber.findOne({ handle:handle }, function (err, newClient) {
			if (!err && newClient) {
				// client already exists - exit
				logger.info('Client ' + handle + ' already subscribed');
			} else {
				var ss = new SalesSubscriber({ 'handle': handle, 'createdAt': new Date() });
				ss.save(function(err) {
					if (err) {
						logger.error('Cannot subscribe new client: ' + err);
					} else {
						logger.info('Client successfully subscribed, firing up MQ listener...');
						sub.connect('piper.events.out', handle + '.sales', function() {
							logger.info('SALES Handler <piper.events.out>: Bound to %s.sales', handle);
						});
					}
				});
			}
		});
		return true;
	} catch (e) {
		logger.error('Unable to subscribe new client: ' + e);
		return false;
	}
}
*/
