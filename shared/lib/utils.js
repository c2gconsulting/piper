var cache = require('./cache').getRedisClient();
var logger = require('./log');
var mq = require('./mq');
var when = require('when');
var request = require('request-promise');
var bitlyConfig = require('../config/bitly.json');

var CACHE_PREFIX = 'utils:';
var CONTEXT_TTL = 300;


// Convert Date String in ISO format to JavaScript Date
exports.dateFromISOString = function(date, callback) {
  
  var dateString = date.replace(/\D/g," ");
  var dateComponents = dateString.split(" ");

  // modify month between 1 based ISO 8601 and zero based Date
  dateComponents[1]--;

  var convertedDate = new Date (Date.UTC(dateComponents[0],dateComponents[1],dateComponents[2],dateComponents[3],dateComponents[4]));
  
  callback(convertedDate);

}

var shortenLink = exports.shortenLink = function(longURL) {
    var requrl = {
        'url': 'https://api-ssl.bitly.com/v3/shorten?',
        'method': 'get',
        'qs': {'access_token': bitlyConfig.GENERIC_ACCESS_TOKEN, 'longUrl': longURL, 'format': 'txt'}
    };
    return request(requrl);
};


exports.getUserLocationLink = function(username, clientHandle, module) {
	// create unique ref
	var ref = new Date().getTime();

	// cache ref with username, clientHandle and module
	if (username && module) {
		var data = { user  : username,
					 client : clientHandle,
					 module : module };
	
		var cachekey = CACHE_PREFIX + ref;
		cache.hmset(cachekey, data);

		var baseURL = 'https://www.piperlabs.com/geo';
		return shortenLink(baseURL + '?ref=' + ref);
		//return baseURL + '?ref=' + ref;
	} else {
		return when(false);
	}

}

exports.processGeo = function(data) {
	// extract ref
	if (data.ref != false) {
		data.ref = getTextFromHyperlink(data.ref);
		var cachekey = CACHE_PREFIX + data.ref;
		logger.debug('CACHEKEY: %s', cachekey);
		cache.hgetall(cachekey).then( function(userdata) {
			if (userdata.module) {
				var pub = mq.context.socket('PUB', {routing: 'topic'});
				qbody = { header : 'GEO_DATA', lat : data.lat, longt : data.longt };
				qdata = { id : new Date().getTime(), user : userdata.user, client: userdata.client, body : qbody };
				logger.info('UTILS: Connecting to MQ Exchange <piper.events.in>...');
				pub.connect('piper.events.in', function() {
					logger.info('UTILS: <piper.events.in> connected');
					pub.publish(userdata.module.toLowerCase(), JSON.stringify(qdata));
				});
			}
			cache.expire(cachekey, CONTEXT_TTL);
		});
	}	
	
}

var getTextFromHyperlink = exports.getTextFromHyperlink = function(linkText) {
    try {
        return linkText.match(/<a [^>]+>([^<]+)<\/a>/)[1];
    } catch (e) {
        return linkText;
    }
}


