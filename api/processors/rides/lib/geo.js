//google api key
var key = 'AIzaSyAirrY3I7ccfsfG9y6LcRsWRkZzLcVhHKA';
var request = require('request-promise');
var when = require('when');
var utils = require('../../../../shared/lib/utils');

exports.getGeoStaticMapLink = function(lat,longt) {
    var latlongt = lat + ',' + longt;
    //var rand = Math.floor((Math.random() * 50) + 1); // random suffix to force unfurling
    return utils.shortenLink('https://maps.googleapis.com/maps/api/staticmap?center=' + latlongt + '&zoom=16&size=400x400&markers=color:red%7Clabel:A%7C' + latlongt);
}

https://maps.googleapis.com/maps/api/geocode/json?latlng=40.714224,-73.961452&key=API_KEY

var getCode = function(address) {
    var body;
    var requrl = {
        'url': 'https://maps.googleapis.com/maps/api/geocode/json?',
        'method': 'get',
        'qs': {'address': address, 'key': key}
    };
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};

var getReverseCode = function(lat, lng) {
    var latlng = lat + ',' + lng;
    var requrl = {
        'url': 'https://maps.googleapis.com/maps/api/geocode/json?',
        'method': 'get',
        'qs': {'latlng': latlng, 'result_type': 'street_address', 'key': key}
    };
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};

var getNearby = function(address){
        //call the getcode method
    //pay attention to error handling
    var nearby = {};

    return getCode(address)
            .then(function(data){
                var res = JSON.parse(data);
                var lat = res.results[0].geometry.location.lat,
                    long = res.results[0].geometry.location.lng,
                    address = res.results[0].address_components;
                    csname = address[address.length - 1].short_name;
                nearby['lat'] = lat;
                nearby['long'] = long;
                nearby['country'] = csname;
                return airports(lat, long)
                    .then(function(x){
                        var sd = x.split('\n');
                        nearby['airports'] = JSON.parse(sd[4]);
                        return nearby; //no reject yet
                    });
            });
    
   
};

var airports = function(lat, long) {
    var requrl = {
        'url': 'http://airports.pidgets.com/v1/airports?',
        'method': 'get',
        'qs': {'near': lat + ',' + long, 'format': 'json'}
    };
   return request(requrl);
};

var getRoutes = function(src, dst){
    var promise = new Promise(function(resolve, reject){

        var count = 0;
        arr = [src, dst];
        result = [];
        var mapped;
        for(var i = 0; i< arr.length; i++)
            aGet(i);

        function aGet(index){
            getNearby(arr[index]).then(function(data) {
                result[index] = {address: arr[index], data: data};
                count += 1;
                checkPlacesCount()
            })
        }

        function checkPlacesCount() {
            //call router mapper and then resolve result.
            if (count == 2) routeMapper(result);

        };

    });
    return promise;

};

var routeMapper = function(arr){
  var src = arr[0],
      dst = arr[1];
    console.log(JSON.stringify(src));
    console.log(JSON.stringify(dst));
//determine closest airport with more carriers as best route
//https://maps.googleapis.com/maps/api/distancematrix/output?parameters



};

module.exports.getCode = getCode;
module.exports.getReverseCode = getReverseCode;
module.exports.getNearby = getNearby;
module.exports.getRoutes = getRoutes;
module.exports.routeMapper = routeMapper;