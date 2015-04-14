//google api key
var key = 'AIzaSyAirrY3I7ccfsfG9y6LcRsWRkZzLcVhHKA';
// request sample https://maps.googleapis.com/maps/api/geocode/output?parameters where output is json or xml
//https://maps.googleapis.com/maps/api/directions/json?origin=lagos&destination=london&sensor=false&key=AIzaSyAirrY3I7ccfsfG9y6LcRsWRkZzLcVhHKA
http://airports.pidgets.com/v1/airports?near=lat,long6&format=json e.g http://airports.pidgets.com/v1/airports?near=6.5243793,3.3792057&format=json
var request = require('request');
var getCode = function(address, callback) {
    var body;
    var requrl = {
        'url': 'https://maps.googleapis.com/maps/api/geocode/json?',
        'method': 'get',
        'qs': {'address': address, 'key': key}
    };
    request(requrl, function (err, res, data) {
        if (err) {
            console.log(err);
        } else {
            console.log('rquest ' + requrl + 'success');
            callback(data);
        }

    });

};
var getNearby = function(address, callback){
        //call the getcode method
    getCode(address, function(data){
        var res = JSON.parse(data);
        var lat = res.results[0].geometry.location.lat,
            long = res.results[0].geometry.location.lng;
        console.log(lat + ',' + long);
        airports(lat, long, function(result){
            callback(result);
        });
    });

    var airports = function(lat, long, cb) {
        var requrl = {
            'url': 'http://airports.pidgets.com/v1/airports?',
            'method': 'get',
            'qs': {'near': lat + ',' + long, 'format': 'json'}
        };
        request(requrl, function(err, res, data){
            if (err) {
                console.log(err);
            } else {
                cb(data);
            }
        })
    };
};
module.exports.getCode = getCode;
module.exports.getNearby = getNearby;