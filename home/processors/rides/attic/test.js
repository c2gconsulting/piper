var EventEmitter = require('events').EventEmitter

var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var when = require('when');
//var nodefn = require('when/node');

var CACHE_PREFIX = 'ridestest:';
var MODULE = 'RIDES';
var MSGKEYS_TTL = 300;


var datakeys = ['a','b','c','d'];
for (var d=0; d<datakeys.length; d++) {
	cache.sadd('test2', datakeys[d]);
}

cache.smembers('test2').then(logger.info);


/*
if (cache.exists(CACHE_PREFIX + 'hey2:datacheck').then(checkValue)) {
	logger.info('2');
} else {
	logger.info('3');
}

logger.info('4');
cache.sadd(CACHE_PREFIX + 'hey1:datacheck', 'yo', function(err, val) {
	logger.warn('4a:' + val);
});
logger.info('5');


function checkValue (val) {
	logger.error('val = ' + val);
	if (val === 0) return false;
	return true;
}*/