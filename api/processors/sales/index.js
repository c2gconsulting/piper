var EventEmitter = require('events').EventEmitter
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var cache = require('../../../shared/lib/cache').getRedisClient();

var CACHE_PREFIX = 'sales:';
var MODULE = 'SALES';
var MSGKEYS_TTL = 300;
	

function Sales(data) {
	EventEmitter.call(this);
	this.pub = mq.context.socket('PUB', {routing: 'topic'});
	this.sub = mq.context.socket('SUB', {routing: 'topic'});
	this.msgid = new Date().getTime();
}

Sales.prototype = Object.create(EventEmitter.prototype);
Sales.prototype.constructor = ChitChat;

Sales.prototype.init = function(){
	// subscribe to inbound MQ exchange
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', MODULE);
	this.sub.connect('piper.events.in', MODULE.toLowerCase(), function() {
		logger.info('%s Processor: <piper.events.in> connected', MODULE);
	});
	var me = this;
	this.sub.on('data', function(data) {
		jsonData = JSON.parse(data);
		if (data) me.in(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
	});

}

/**
 * Receive a message for processing from the front-end
 * @param username - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Sales.prototype.out = function(username, client, body) {
	this.push(username, client.slackHandle, body);
}

/**
 * Receive a message from back-end handlers for processing
 * @param username - the user this request is associated with
 * @param clientHandle - handle of the company that owns this message
 * @param body - JSON object with request details
 */
Sales.prototype.in = function(msgid, username, clientHandle, body) {
	var me = this;

	// check for message uniqueness
	if (this.msgid !== msgid) {
		//cache.sismember(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid, function(err, check) {
		//	if (!err && check === 0) {
				// not duplicate, process
		//		logger.warn('MESSAGE deets ' + msgid + JSON.stringify(body));
		//		cache.sadd(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid);
				me.emit('message', MODULE, username, clientHandle, body.text);
		//	}	
		//});
		this.msgid = msgid;
	}
	//cache.expire(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', MSGKEYS_TTL);	
}


/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
Sales.prototype.push = function(username, clientHandle, body) {
	data = {  'id': new Date().getTime(), 'user': username, 'client': clientHandle, 'body': body };
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', MODULE);
	var me = this;
	this.pub.connect('piper.events.out', function() {
		logger.info('%s Processor: <piper.events.out> connected', MODULE);
		me.pub.publish(clientHandle + '.' + MODULE.toLowerCase(), JSON.stringify(data));
	});
}


module.exports = Sales;



