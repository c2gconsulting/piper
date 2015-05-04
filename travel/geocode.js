var logger = require('../shared/lib/log');
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

function today(){
    var today = new Date();
    //default hours, minutes and seconds to 00
    today.setHours(00); today.setMinutes(00); today.setSeconds(00);
    var yyyy = today.getFullYear();
    var mm = parseInt(today.getMonth()) + 1 < 10 ? '0' + (parseInt(today.getMonth()) + 1) : parseInt(today.getMonth()) + 1;
    var dd = today.getDate() < 10 ? '0' + today.getDate() : today.getDate();
    return date = yyyy + '-' + mm + '-' + dd;
};

var getCode = function(address) {
    var body;
    var requrl = {
        'url': 'https://maps.googleapis.com/maps/api/geocode/json?',
        'method': 'get',
        'qs': {'address': address, 'key': key}
    };
    return request(requrl);
};

var getNearby = function(addr){
        //call the getcode method
    //pay attention to error handling
    var nearby = {};



    var promise = new Promise(function(resolve, reject){
        getCode(addr)
            .then(function(data){
                //check if result is empty else process the information
                var res = JSON.parse(data);
                if(res.results.length == 0) {
                    res['address'] = addr;
                    resolve(res); //
                }else {
                    var lat = res.results[0].geometry.location.lat,
                        long = res.results[0].geometry.location.lng,
                        address = res.results[0].address_components;
                    csname = _.find(address, function(obj){
                        var types = obj.types;
                        for(var i = 0; i < types.length; i++){
                            if(types[i] == "country") return obj;
                        }
                    });
                    nearby['address']= addr;
                    nearby['lat'] = lat;
                    nearby['long'] = long;
                    nearby['country'] = csname || "undefined";
                    airports(lat, long)
                        .then(function(x){
                            var sd = x.split('\n');
                            //nearby airports must be in the same country and must be type 'Airport'
                            nearby['airports'] = _.where(JSON.parse(sd[4]), {type: "Airports", country: nearby['country']['long_name']});
                            var airports = nearby['airports'];
                            resolve(nearby); //no reject yet
                        });
                }


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
    // first determine if flight is needed;
    //
    //
    var promise = new Promise(function(resolve, reject){

        var count = 0;
        arr = [src, dst];
        result = [];
        var mapped;
        for(var i = 0; i< arr.length; i++)
            aGet(i);

        function aGet(index){
            getNearby(arr[index]).then(function(data) {
                result[index] = data;
                count += 1;
                checkPlacesCount()
            })
        }

        function checkPlacesCount() {
            //call router mapper and then resolve result.
            if (count == 2) {
                //resolve(result);
                //check if any result is empty... if empty no need of router mapper
                var msg = '';
                var sadd, dadd;
                for(var i = 0; i < result.length; i++){
                    if(result[i].hasOwnProperty('results')){
                    switch (i) {
                        case 0:
                            sadd = result[i]['address'];
                            msg = 'Could not determine source ' + sadd;
                            break;
                        case 1:
                            dadd = result[i]['address'];
                            if(msg) { //this means that source could not be determined
                                msg = 'Could not determine Source = ' + sadd + ' and destination = ' + dadd;
                            } else { msg = 'Could not determine Destination ' + dadd }
                            break;
                    }
                    }
                }
                if (msg) { //no need to call router mapper send a response to show invalid address
                        resolve(msg);
                } else {
                    routeMapper(result)
                        .then(function(x){
                            resolve(x);
                        })

                }
            }

        };

    });
    return promise;

};

var routeMapper = function(arr){
    logger.info('Processing result with router mapper');
    var carrier, mpop = [],sdist = [],weightedOpt = [];
    for(var i = 0; i < arr.length; i++){
        mpop[i] = _.max(arr[i]['airports'], function(pop){ return  parseInt(pop.carriers)});
        sdist[i]= arr[i]['airports'][0]; //result sorted by distance 'recalculate distance using google distance matrix'
        weightedOpt[i] = weigh(arr[i]['airports']);
    }
    carrier = { most_popular: mpop, shortest_distance: sdist, weightedOpt: weightedOpt };
    return promise(carrier);
    //determine flights for most popular airport and
    //var mpopOrigin = carrier['most_popular'][0]['code'];
    //var mpopDestination = carrier['most_popular'][1]['code'];
    //var sdistOrigin = carrier['shortest_distance'][0]['code'];
    //var sdistDestination = carrier['shortest_distance'][1]['code'];
    //var weightedOrigin = carrier['weightedOpt'][0]['code']
    //var searchObj = { mpopFlightOptions : flightSearch({origin:mpopOrigin, destination: mpopDestination}), sdistFlightOptions : flightSearch({origin:sdistOrigin, destination:sdistDestination}) };
    //return promise(searchObj);
};

var routeOptions = function(src,dst){
    // use google directions api to determine best route
    //https://maps.googleapis.com/maps/api/directions/json?origin=turino&destination=lazio&mode=transit&key=KEY
    var mode = 'transit';
        var requrl = {
            'url': 'https://maps.googleapis.com/maps/api/directions/json?',
            'method': 'get',
            'qs': {'origin': src, 'destination': dst, 'mode': mode, 'key': key}
        };
    request(requrl).then(function(res){
        logger.debug(res);
    });
}

//Rad()
Number.prototype.toRad = function() {
    return this * Math.PI / 180;
}
// distance between two points
// use google distance api or haversine formular to determine distance
function flightSearch(obj){
   // use google qpx-express api for flight search.
    var re = /\b(^[A-Z]{3})\b$/;
    var dre = /\b(^\d{4}-\d{1,2}-\d{1,2})\b$/;
    //check if origin and destination iata code is valid
    if (re.test(obj.origin) && re.test(obj.destination)) {
        if(obj.date){
            if (dre.test(obj.date)){
                //check if date is in the past
                var check = diffInDays(new Date(obj.date), today);
                if (check < 0) {
                    return promise("Date supplied is in the past... to get flights for today you can either leave the date parameter blank or specify todays date.");
                } else {
                    //perform search and return promisified response
                    return search()
                }
            }else {
                //error message with expected date format
                return promise("Date supplied is not in the required format... please specify date in 'YYYY-MM-DD' format.");
            }

        } else {
            var date = today();
            return search();
        }


    } else {
        var message = "Invalid IATA code please enter a 3 digit IATA city or airport code e.g LOS for params origin and destination"
        return promise(message);
    }

    function search(){
        var body = {
            "request": {
                "passengers": {
                    "kind": "qpxexpress#passengerCounts",
                    "adultCount": obj.adultCount || 1,
                    "childCount": obj.childCount || 0,
                    "infantInLapCount": obj.infantInLapCount || 0,
                    "infantInSeatCount": obj.infantInSeatCount || 0,
                    "seniorCount": obj.seniorCount || 0
                },
                "slice": [
                    {
                        "kind": "qpxexpress#sliceInput",
                        "origin": obj.origin,
                        "destination": obj.destination,
                        "date": obj.date || date,
                        "maxStops": obj.maxStops || 1,
                        "maxConnectionDuration": obj.maxConnectionDuration || 240,
                        "preferredCabin": obj.preferredCabin || '',
                        "permittedDepartureTime": {
                            "kind": "qpxexpress#timeOfDayRange",
                            "earliestTime": obj.earliestTime || '',
                            "latestTime": obj.latestTime || ''
                        },
                        "permittedCarrier": obj.prohibitedCarrier || [],
                        "alliance": '',
                        "prohibitedCarrier": obj.prohibitedCarrier || []
                    }
                ],
                "maxPrice": obj.maxPrice || '',
                "saleCountry": obj.saleCountry || '',
                "refundable": obj.refundable || false,
                "solutions": 20
            }
        };

        var requrl = {
            'url': 'https://www.googleapis.com/qpxExpress/v1/trips/search?',
            'method': 'POST',
            'qs': {'key': key},
            'json': true,
            'body': body
        };
        return request(requrl);

    }

}
//promise for all
function promise(msg){
    // return a new promise with msg
    var promise = new Promise(function(resolve,reject){
        resolve(msg);
    });
    return promise;
};

function diffInDays(d1,d2) {
    var oneDay = 1000 * 60 * 60 * 24;
    // get absolute value of d1 - d2
    return Math.round((d1.getTime() - d2.getTime())/oneDay);
}
function weigh(arr){
    var penalty = 50;
    var w = [];
    try {
        for(var i=0; i < arr.length; i++) {
           w[i] = (-(parseInt(arr[i]['dist']) / penalty)) + parseInt(arr[i]['carriers']);
        };
        var pick = arr[w.indexOf(_.max(w))];
        return pick;

    } catch(e){
        logger.error(e);
    }
};

function checkDistance(pt1,pt2){

};

module.exports.getCode = getCode; //
module.exports.getNearby = getNearby; //
module.exports.getRoutes = getRoutes;  //
module.exports.routeMapper = routeMapper; //
module.exports.flightSearch = flightSearch; //http://travel.example.com/flightsearch?origin=AMS&destination=SZG