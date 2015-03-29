var EventEmitter = require('events').EventEmitter
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');

var CACHE_PREFIX = 'chitchat:';
var MODULE = 'CHITCHAT';
var cache;


function ChitChat(data) {
	EventEmitter.call(this);
	cache = require('../../../shared/lib/cache').getRedisClient();
	this.pub = mq.context.socket('PUB', {routing: 'topic'});
	this.sub = mq.context.socket('SUB', {routing: 'topic'});
}

ChitChat.prototype = Object.create(EventEmitter.prototype);
ChitChat.prototype.constructor = ChitChat;

ChitChat.prototype.init = function(){
	// subscribe to inbound MQ exchange
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', MODULE);
	this.sub.connect('piper.events.in', MODULE.toLowerCase(), function() {
		logger.info('%s Processor: <piper.events.in> connected', MODULE);
	});
}

/**
 * Receive a message for processing from the front-end
 * @param username - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
ChitChat.prototype.out = function(username, client, body) {
	var Cleverbot = require('./cleverbot');
	var cBot = new Cleverbot();
	var me = this;
  	cBot.write(body._text, function(err, text){
  		if (!err) {
  			me.emit('message', MODULE, username, client, text);	
  		} else {
  			me.emit('error', MODULE, username, client, err, text);
  		}
  	});
}

/**
 * Receive a message from back-end handlers via the controller for processing
 * @param username - the user this request is associated with
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
ChitChat.prototype.in = function(username, client, body) {
	
}

/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
ChitChat.prototype.push = function(username, clientHandle, body) {
	data = { 'user': username, 'client': clientHandle, 'body': body };
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', MODULE);
	this.pub.connect('piper.events.out', function() {
		logger.info('%s Processor: <piper.events.out> connected', MODULE);
		this.pub.publish(clientHandle + '.' + MODULE.toLowerCase(), JSON.stringify(message));
	});
}


module.exports = ChitChat;



