//require response.json.
var response = require('./response');
var dbReturn = function(obj) {
    try {
    var arq;
    var startDate,endDate,startTime,endTime,origin,destination, sdate, edate,mode;
    //check for information completenes and respond according to object.
// process logic goes here //first set variables to hold data
    sdate = obj.startdate ? obj.startdate : '';
    edate = obj.enddate ? obj.enddate : '';
    origin = obj.origin ? obj.origin : '';
    destination = obj.destination ? obj.destination : '';
    mode = obj.mode ? obj.mode : '';
    if (sdate !== '') {
        var sd = new processDate(sdate);
        startDate = sd.getDate();
        startTime = sd.getTime();
    };
    if (edate !== '') {
        var ed = new Date(edate);
        endDate = ed.getDate();
        endTime = ed.getTime();
    }
        console.log("startdate:" + startDate + " startTime:" + startTime + " enddate " + endDate + " endTime :" + endTime + " origin:" + origin + " destination:" + destination + " mode:" + mode );

    //now check dependencies to determine next move
    if (startDate && startTime && endDate && endTime && origin && destination && mode ) {
        //retrieve response
        // using an algorithm that processes more data and then resolve to less data based on entity found or supplied.
        arq = response['complete'];
        q = randomizer(arq);
        return arq[q];
    } else if (!startDate && !startTime && !endDate && !endTime & !origin && !destination && !mode) { // no value supplied yet
        arq = response['initialize'];
        q = randomizer(arq);
        return arq[q];
    } else if (!origin && !destination ) {
        arq = response['getSourceAndDestination'];
        q = randomizer(arq);
        return arq[q];
    } else if (!startDate && !endDate ) {
        arq = response['getStartAndEndDate'];
        q = randomizer(arq);
        return arq[q];
    } else if (!startDate) {
        arq = response['getStartDateAndTime'];
        q = randomizer(arq);
        return arq[q];
    } else if (!endDate) {
        arq = response['getEndDateAndTime'];
        q = randomizer(arq);
        return arq[q];
    }   else if (!destination) {
        arq = response['getDestination'];
        q = randomizer(arq);
        return arq[q];
    }   else if (!origin) {
        arq = response['getSource'];
        q = randomizer(arq);
        return arq[q];
    }   else if (!mode) {
        arq = response['getMode'];
        q = randomizer(arq);
        return arq[q];
    }   else {
        arq = response['getHelp'];
        q = randomizer(arq);
        return arq[q];
    }


    } catch(e) {
        console.log("An error occurred during beta processing  " + e);
        return e;
    }
};
var processDate = function(date) {
    //will convert the date to javascript date using
    //var date = new Date("date"); and use standard date functions
    var date = new Date(date);
    var yyyy = date.getFullYear();
    var mm = date.getMonth() + 1 < 10 ? '0' + date.getMonth() + 1 : date.getMonth() + 1;
    var dd = date.getDate() < 10 ? '0' + date.getDate() : date.getDate();
    var hh = date.getHours() < 10 ? '0' + date.getHours() : date.getHours();
    var ms = date.getMinutes() < 10 ? + '0' + date.getMinutes() : date.getMinutes();
    this.getDate = function() {
        return yyyy + ':' + mm + ':' + dd;
    }
    this.getTime = function() {
        return hh + ':' + ms;
    }
};

var randomizer = function(n) {
   return Math.floor(Math.random() * n.length)
};

module.exports = dbReturn;