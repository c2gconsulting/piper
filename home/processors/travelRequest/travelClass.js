//this class provides several methods that we can use to manipulate response body and intent
var getVar = function(obj) {
    var obj = obj;
    //get all entities from ibody
        this.entGet = function() {
        //extract the first element of outcomes array into var outcome object from obj
        var outcome = obj.outcomes[0].entities;
        var ent = {booked: false};
        //loop through every element of outcome and process the entities and get the keys
        for(key in outcome) {
            ent[key] = outcome[key][0].value;
            console.log("Entities passed : " + key + ":" + outcome[key][0].value);
        }
        console.log(ent);
        return ent;
    };

// check if entity object is empty
    this.isEmpty = function (entity) {
        for(var prop in entity) {
            if(entity.hasOwnProperty(prop))
                return false;
        }

        return true;
    };
// function to merge two objects
    this.merge = function(obj1,obj2,rt){
        try {
            var obj3 = {};
            for (var t in obj1) { obj3[t] = obj1[t]; }
            for (var q in obj2) { obj3[q] = obj2[q]; }
            rt(obj3, '');
            return obj3;

        } catch(e){
            rt('', e);
            console.log('Mergin error' + e);
        }
    };
    this.proc = function(u) {
        var origin, destination, sdate,stime,edate,etime;
        origin = u['startdate'];
        destination = u['destination'];


    };
    this.processDate = function(date) {
        var dt = date.split('T');
        return dt[0];
    };
    this.intentBetaProc = function(obj) {
        //This function gets the intent and then based on some parameters sends it to the right processor.

    };
    this.processTime = function(date) {
      var dt = date.split('T');
        var t = dt.split('-');
        return t[1];
    };

};
module.exports = getVar;
