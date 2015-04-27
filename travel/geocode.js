//google api key
var key = 'AIzaSyAirrY3I7ccfsfG9y6LcRsWRkZzLcVhHKA';
// request sample https://maps.googleapis.com/maps/api/geocode/output?parameters where output is json or xml
//https://maps.googleapis.com/maps/api/directions/json?origin=lagos&destination=london&sensor=false&key=AIzaSyAirrY3I7ccfsfG9y6LcRsWRkZzLcVhHKA
http://airports.pidgets.com/v1/airports?near=lat,long6&format=json e.g http://airports.pidgets.com/v1/airports?near=6.5243793,3.3792057&format=json
var request = require('request-promise');
//using underscore
var _ = require('underscore');
//using when
var when = require('when');
var NEGLETED_DISTANCE  = 30;

var getCode = function(address) {
    var body;
    var requrl = {
        'url': 'https://maps.googleapis.com/maps/api/geocode/json?',
        'method': 'get',
        'qs': {'address': address, 'key': key}
    };
    return request(requrl);
};

var getNearby = function(address){
        //call the getcode method
    //pay attention to error handling
    var nearby = {};


    var promise = new Promise(function(resolve, reject){
        getCode(address)
            .then(function(data){
                var res = JSON.parse(data);
                var lat = res.results[0].geometry.location.lat,
                    long = res.results[0].geometry.location.lng,
                    address = res.results[0].address_components;
                    csname = address[address.length - 1].long_name;
                nearby['lat'] = lat;
                nearby['long'] = long;
                nearby['country'] = csname;
                airports(lat, long)
                    .then(function(x){
                        var sd = x.split('\n');
                        nearby['airports'] = _.where(JSON.parse(sd[4]), {type: "Airports"});
                        var airports = nearby['airports'];
                        resolve(nearby); //no reject yet
                    });
            });
    });
    return promise;
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
            if (count == 2) {
                //resolve(result);
                routeMapper(result);
            }

        };

    });
    return promise;

};

var routeMapper = function(arr){
    var carrier = [], mpop = [],sdist = [];
    for(var i = 0; i < arr.length; i++){
        mpop[i] = _.max(arr[i]['data']['airports'], function(pop){ return  parseInt(pop.carriers)});
        console.log(mpop[i]);
        //for(j = 0; j<airports.length; j++){
        //    pick[j] = parseInt(airports[j].carriers);
        //}
        //console.log(pick);
        // pick index of highest value in array
        //var hcarrier = pick.indexOf(Math.max.apply(Math, pick));
        //console.log(airports[hcarrier]);
        //console.log(airports[0]);
        //sorted according to distance
        //determine distance form place source and origin to airport
        //using google distance matrix
        //https://maps.googleapis.com/maps/api/distancematrix/output?parameters
        //var requrl = {
        //    'url': 'https://maps.googleapis.com/maps/api/distancematrix/json?',
        //    'method': 'get',
        //    'qs': {'origins': src, 'destinations': dst, 'key': key}
        //};
        //request(requrl).then(function(res){
        //   console.log(res);
        //});
    }
    return mpop
//determine closest airport with more carriers as best route




};

module.exports.getCode = getCode;
module.exports.getNearby = getNearby;
module.exports.getRoutes = getRoutes;
module.exports.routeMapper = routeMapper;