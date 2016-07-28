'use strict';

var PokemonGO = require('pokemon-go-node-api');
var request = require('request');
var geolib = require('geolib');
var _ = require('lodash');

var metrics = require('./metrics');

var winston;
if ( process.env.LOGGLY_TOKEN ){
  winston = require('winston');
  require('winston-loggly-bulk');
  winston.add(winston.transports.Loggly, {
    token: process.env.LOGGLY_TOKEN,
    subdomain: process.env.LOGGLY_SUBDOMAIN,
    tags: ["Winston-NodeJS"],
    json: true
  });
}else{
  winston = {
    log   : function(type,msg){ console.log(type+"\t: "+msg); },
    error : function(msg){ console.log("E\t: "+msg); }
  }
}

winston.log('info',"Initialised");

var a = new PokemonGO.Pokeio();

var location = {
  type: 'name',
  name:  '39.326539499999996,-84.4218144',
};

var username = process.env.PGO_USERNAME || 'jacobboyles';
var password = process.env.PGO_PASSWORD || 'baseball200';
var provider = process.env.PGO_PROVIDER || 'ptc';

var pokeMap = {};

a.init(username, password, location, provider, function(err) {
  if (err) console.log(err);

  winston.log('info', 'Current location: ' + a.playerInfo.locationName);
  winston.log('info', 'lat/long/alt: : ' + a.playerInfo.latitude + ' ' + a.playerInfo.longitude + ' ' + a.playerInfo.altitude);
  var start_location = {latitude:a.playerInfo.latitude,
    longitude:a.playerInfo.longitude};

  a.GetProfile(function(err, profile) {
    if (err) throw err;

    winston.log('info', 'Username: ' + profile.username);
    // console.log('1[i] Poke Storage: ' + profile.poke_storage);
    // console.log('1[i] Item Storage: ' + profile.item_storage);
    //
    // var poke = 0;
    // if (profile.currency[0].amount) {
    //   poke = profile.currency[0].amount;
    // }
    //
    // console.log('1[i] Pokecoin: ' + poke);
    // console.log('1[i] Stardust: ' + profile.currency[1].amount);

    setInterval(function() {
      a.Heartbeat(function (err,hb) {
        if(err) {
          winston.log('error', err);
        }

        if (!hb || !hb.cells) {
          winston.log('error', 'hb or hb.cells undefined - aborting');
        } else {
          for (var i = hb.cells.length - 1; i >= 0; i--) {
            if(hb.cells[i].WildPokemon[0]) {
              var wildPokemon = hb.cells[i].WildPokemon;
              var newPokeMap = {};
              for (var j = wildPokemon.length - 1; j >= 0; j--) {
                var pokeId = wildPokemon[j].pokemon.PokemonId;
                var pokemon = a.pokemonlist[parseInt(pokeId)-1];
                newPokeMap[ pokemon.id ] = true;

                var pokemonAlreadyPresent = pokeMap[ pokemon.id ];

                if (!pokemonAlreadyPresent) {
                  var latitude = wildPokemon[j].Latitude;
                  var longitude = wildPokemon[j].Longitude;

                  var position = { latitude : wildPokemon[j].Latitude,
                    longitude : wildPokemon[j].Longitude};
                  var distance = geolib.getDistance(position,start_location)
                  if ( true == true ){
                    let image = `https://maps.googleapis.com/maps/api/staticmap?center=${position.latitude},${position.longitude}&size=640x400&style=element:labels|visibility:off&style=element:geometry.stroke|visibility:off&style=feature:landscape|element:geometry|saturation:-100&style=feature:water|saturation:-100|invert_lightness:true&key=AIzaSyBmhVz0j9QcBbHfYtusRMQfjSELV24gLkc&zoom=14&&markers=color:blue%7Clabel:S%7C${position.latitude},${position.longitude}`;
                    var message = 'There is a *' + pokemon.name + '* ('+pokemon.num+') '+distance+'m away! <https://maps.google.co.uk/maps?f=d&dirflg=w&saddr=' + start_location.latitude+","+start_location.longitude+'&daddr=' + position.latitude + ',' + position.longitude+'|Route>';
                    if ( true == true ){
                      request.post({
                        url: "https://hooks.slack.com/services/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",
                        json: true,
                        body: {
                          text: message,
                          icon_url: pokemon.img,
                          "attachments": [
                            {
                            "image_url":image,
                            }
                          ]
                        }
                      }, function(error, response, body) {
                        if (error) winston.log('error', error);
                        if(response.body) console.log(response.body);
                      });
                    }
                    winston.log('info', "POST: "+ message );
                  } else {
                    winston.log('info', pokemon.name + ' not interesting: skipping');
                  }
                } else {
                  winston.log('info', pokemon.name + ' already present: skipping');
                }
              }
              pokeMap = newPokeMap;
            }
          }
        }
      });
    }, 60000);
  });
});
