var request = require('request-promise');
var when = require('when');
var _ = require('underscore');
var utils = require('../../shared/lib/utils');

// AUTH details
var UBER_CLIENT_ID = "wTO4c5RIwLi_gjwN1tw79JY4_1W2Im1w";
var UBER_SERVER_TOKEN = "56IrLXS0bglH4WT695YKkXIpaojpHmfoTgn3qE83";
var UBER_SECRET = "oKXU97Mj_5Po9udA666Tl-wfUt93-u0oPAbk8_NS";

// Endpoints
var base_url = exports.base_url = "https://api.uber.com",
    sandbox_base_url = exports.sandbox_base_url = "https://sandbox-api.uber.com",
    access_token_url = exports.access_token_url = "https://login.uber.com/oauth/token",
    authorize_url = exports.authorize_url = "https://login.uber.com/oauth/authorize",
    login_url = exports.login_url = "https://login.uber.com",
    redirect_uri = exports.redirect_uri = "https://uber.piperlabs.com/oauth";

var uber_map_image = 'http://j.mp/vublack';

var scope = 'profile request history';

var getBearerHeaders = function (bearer_token, others) {
    return _.extend(others || {}, {
        'Authorization': 'Bearer ' + bearer_token
    });
};

var getBearerHeadersJSON = function (bearer_token, others) {
    return _.extend(others || {}, {
        'Authorization': 'Bearer ' + bearer_token,
        'Content-Type': 'application/json'
    });
};

var getTokenHeaders = function () {
    return {
        'Authorization': 'Token ' + UBER_SERVER_TOKEN
    };
};

/**
 * getAuthorizeLink Returns the uber auth link. 
 * @param state Unique tag representing the user to be used to identify the caller
 * @param responseType (optional). Defaults to 'code'
 */
var getAuthorizeLink = function (state, responseType) {
    if (!responseType) responseType = 'code';
    return authorize_url + '?response_type=' + responseType + '&client_id=' + UBER_CLIENT_ID + '&state=' + state + '&scope=' + scope; 
};

/**
 * getDriverMap Returns a link to a google map image with driver location. 
 * @param clat Map center latitude (user location)
 * @param clng Map center longitude (user location)
 * @param dlat Driver latitude
 * @param dlng Driver longitude
 */
var getDriverMap = function(clat,clng,dlat,dlng) {
    var clatlongt = clat + ',' + clng;
    var dlatlongt = dlat + ',' + dlng;
    return utils.shortenLink('http://maps.googleapis.com/maps/api/staticmap?center=' + clatlongt + '&size=400x400&markers=icon:' + uber_map_image + '|' + dlatlongt);
}



/**
 * getUserAccessToken Retrieve access token for user authorization code. 
 * @param code The authorization code
 */
var getUserAccessToken = function (code) {
    var requrl = {
        url : access_token_url,
        method : 'post',
        qs : {
            'client_secret': UBER_SECRET,
            'client_id': UBER_CLIENT_ID,
            'grant_type': 'authorization_code',
            'redirect_uri': redirect_uri,
            'code': code
        }
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};

/**
 * refreshUserToken Retrieve access token for user authorization code. 
 * @param refreshToken The authorization code
 */
var refreshUserToken = function (refreshToken) {
    var requrl = {
        url : access_token_url,
        method : 'get',
        qs : {
            'client_secret': UBER_SECRET,
            'client_id': UBER_CLIENT_ID,
            'grant_type': 'refresh_token',
            'redirect_uri': redirect_uri,
            'refresh_token': refreshToken
        }
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};

/**
 * getProducts Returns information about the Uber products offered at a given location. 
 * The response includes the display name and other details about each product in the proper display order
 * @param lat the latitude of the given location
 * @param lng the longitude of the given location
 */
var getProducts = function (lat, lng) {
    var resource = '/v1/products' ;
    var requrl = {
        url : base_url + resource,
        method : 'get',
        qs : {
            'latitude': lat,
            'longitude' : lng
        },
        headers : getTokenHeaders()
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
    });

};


/**
 * getProductDetails Returns information about a specific product
 * @param productId Unique identifier representing a specific product for a given location

 */
var getProductDetails = function (productId) {
    var resource = '/v1/products/' + productId;
    var requrl = {
        url : base_url + resource,
        method : 'get',
        headers : getTokenHeaders()
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * getPriceEstimates Returns an estimated price range for each product offered at a given location.
 * The price estimate is provided as a formatted string with the full price range and the localized currency symbol
 * @param startlat Latitude component of start location
 * @param startlng Longitude component of start location
 * @param endlat Latitude component of end location
 * @param endlng Longitude component of end location
 */
var getPriceEstimates = function (startlat, startlng, endlat, endlng) {
    var resource = '/v1/estimates/price' ;
    var requrl = {
        url : base_url + resource,
        method : 'get',
        qs : {
            'start_latitude': startlat,
            'start_longitude' : startlng,
            'end_latitude': endlat,
            'end_longitude' : endlng  
        },
        headers : getTokenHeaders()
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * getTimeEstimates Returns ETAs for all products offered at a given location, with the responses expressed as integers in seconds.
 * @param startlat Latitude component of start location
 * @param startlng Longitude component of start location
 * @param productId Unique identifier representing a specific product for a given latitude & longitude (optional)
 */
var getTimeEstimates = function (startlat, startlng, productId) {
    var resource = '/v1/estimates/time' ;
    var requrl = {
        url : base_url + resource,
        method : 'get',
        qs : {
            'start_latitude': startlat,
            'start_longitude' : startlng
        },
        headers : getTokenHeaders()
    };
    if (productId) requrl.qs.product_id = productId;
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};


/**
 * getUserActivity Returns a limited amount of data about a user's lifetime activity with Uber  
 * @param bearer_token OAuth 2.0 bearer token with history scope
 * @param offset Offset the list of returned results by this amount. Default is zero.
 * @param limit Number of items to retrieve. Default is 5, maximum is 50.
 */
var getUserActivity = function (bearer_token, offset, limit) {
    var resource = '/v1.2/history';
    
    // input validation
    if (!offset) offset = 0;
    if (!limit) offset = 5;
    if (limit > 50) limit = 50;

    var requrl = {
        url : base_url + resource,
        method : 'get',
        qs : {
            'offset': offset,
            'limit': limit
        },
        headers: getBearerHeaders(bearer_token)
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};


/**
 * rideRequest Allows a ride to be requested on behalf of an Uber user  
 * @param bearer_token OAuth 2.0 bearer token with the request scope
 * @param startlat Latitude component of start location
 * @param startlng Longitude component of start location
 * @param endlat Latitude component of end location
 * @param endlng Longitude component of end location
 * @param prod Boolean to indicate if production or sandbox endpoints (true=production)
 * @param surgeConfirmationId Surge confirmation id (optional)
 */
var rideRequest = function (bearer_token, productId, startlat, startlng, endlat, endlng, prod, surgeConfirmationId) {
    var resource = '/v1/requests' ;
    var root_url = prod === true ? base_url : sandbox_base_url;
    var requrl = {
        url : root_url + resource,
        method : 'post',
        json : {
            'product_id': productId,
            'start_latitude': startlat,
            'start_longitude' : startlng,
            'end_latitude': endlat,
            'end_longitude' : endlng
        },
        headers: getBearerHeadersJSON(bearer_token)
    };
    if (surgeConfirmationId) requrl.qs.surge_confirmation_id = surgeConfirmationId;
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * getRequestEstimate Allows a ride to be estimated given the desired product, start, and end locations.  
 * @param bearer_token OAuth 2.0 bearer token with the request scope
 * @param startlat Latitude component of start location
 * @param startlng Longitude component of start location
 * @param endlat Latitude component of end location
 * @param endlng Longitude component of end location
 */
var getRequestEstimate = function (bearer_token, productId, startlat, startlng, endlat, endlng) {
    var resource = '/v1/requests/estimate' ;
    var requrl = {
        url : base_url + resource,
        method : 'post',
        json : {
            'product_id': productId,
            'start_latitude': startlat,
            'start_longitude' : startlng,
            'end_latitude': endlat,
            'end_longitude' : endlng
        },
        headers: getBearerHeadersJSON(bearer_token)
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * getRequestDetails Gets the real time status of an ongoing trip that was created using the Ride Request endpoint.
 * @param bearer_token OAuth 2.0 bearer token with the request scope
 * @param request_id Unique identifier representing a Request
 * @param prod Boolean to indicate if production or sandbox endpoints (optional)
 */
var getRequestDetails = function (bearer_token, requestId, prod) {
    var resource = '/v1/requests/' + requestId;
    var root_url = prod === true ? base_url : sandbox_base_url;
    var requrl = {
        url : root_url + resource,
        method : 'get',
        headers: getBearerHeaders(bearer_token)
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * cancelRequest Cancel an ongoing Request on behalf of a rider.
 * @param bearer_token OAuth 2.0 bearer token with the request scope
 * @param request_id Unique identifier representing a Request
 * @param prod Boolean to indicate if production or sandbox endpoints (optional)
 */
var cancelRequest = function (bearer_token, requestId, prod) {
    var resource = '/v1/requests/' + requestId;
    var root_url = prod === true ? base_url : sandbox_base_url;
    var requrl = {
        url : root_url + resource,
        method : 'delete',
        headers: getBearerHeaders(bearer_token)
    };
    
    return request(requrl);

};


/**
 * getRequestMap Get a map with a visual representation of a Request.
 * @param bearer_token OAuth 2.0 bearer token with the request scope
 * @param request_id Unique identifier representing a Request
 * @param prod Boolean to indicate if production or sandbox endpoints (optional)
 */
var getRequestMap = function (bearer_token, requestId, prod) {
    var resource = '/v1/requests/' + requestId + '/map';
    var root_url = prod === true ? base_url : sandbox_base_url;
    var requrl = {
        url : root_url + resource,
        method : 'get',
        headers: getBearerHeaders(bearer_token)
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

/**
 * getRequestReceipt Get the receipt information of the completed request.
 * @param bearer_token OAuth 2.0 bearer token with the request_receipt scope
 * @param request_id Unique identifier representing a Request
 * @param prod Boolean to indicate if production or sandbox endpoints (optional)
 */
var getRequestReceipt = function (bearer_token, requestId, prod) {
    var resource = '/v1/requests/' + requestId + '/receipt';
    var root_url = prod === true ? base_url : sandbox_base_url;
    var requrl = {
        url : root_url + resource,
        method : 'get',
        headers: getBearerHeaders(bearer_token)
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};

module.exports.getAuthorizeLink = getAuthorizeLink;
module.exports.getUserAccessToken = getUserAccessToken;
module.exports.getProducts = getProducts;
module.exports.getProductDetails = getProductDetails;
module.exports.getPriceEstimates = getPriceEstimates;
module.exports.getTimeEstimates = getTimeEstimates;
module.exports.getUserActivity = getUserActivity;
module.exports.rideRequest = rideRequest;
module.exports.getRequestEstimate = getRequestEstimate;
module.exports.getRequestDetails = getRequestDetails;
module.exports.cancelRequest = cancelRequest;
module.exports.getRequestMap = getRequestMap;
module.exports.getRequestReceipt = getRequestReceipt;
