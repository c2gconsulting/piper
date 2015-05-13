var Log = require('log');
var cache = require('../lib/cache').getRedisClient();
var CACHE_PREFIX = 'test:';

// Initialize logger
var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');

cache.hmset(CACHE_PREFIX + 'hash', 'name', 'ETE', 'age', '28');

cache.hgetall(CACHE_PREFIX + 'hash', function(err, obj) {
	if (!err && obj) {
		logger.info('REDIS Retrieved: ' + JSON.stringify(obj));
	} else {
		logger.error('Cannot retrieve REDIS: ' + err); 
	}
	process.exit(0);
});

