'use strict';


const PokemonGO = require('pokemon-go-node-api');
const request = require('request');

const logger = require('./logger');
const metrics = require('./metrics');
const geo = require('./geo');

logger.log('info', 'Initialised');

const a = new PokemonGO.Pokeio();

const location = {
  type: 'name',
  name: process.env.PGO_LOCATION,
};

const geoLocation = process.env.PGO_LOCATION.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
if (geoLocation) {
  location.type = 'coords';
  location.coords = {
    latitude: parseFloat(geoLocation[1]),
    longitude: parseFloat(geoLocation[2]),
    altitude: 0.0,
  };
}

var username = process.env.PGO_USERNAME;
var password = process.env.PGO_PASSWORD;
var provider = process.env.PGO_PROVIDER || 'google';
var slackURL = process.env.SLACK_WEBHOOK_URL;
var googleAPI = process.env.MAPS_API;
var start_location;


a.init(username, password, location, provider, (err) => {
  if (err) {
    logger.error(err);
    process.exit(2);
  }

  logger.log('info', `Current location: ${a.playerInfo.locationName}`);
  logger.log('info', `lat/long/alt: : ${a.playerInfo.latitude} ${a.playerInfo.longitude} ${a.playerInfo.altitude}`);
  start_location = {
    latitude: a.playerInfo.latitude,
    longitude: a.playerInfo.longitude,
  };

  a.GetProfile((err, profile) => {
    if (err) {
      logger.error(err);
      process.exit(3);
    }

    logger.log('info', `Username: ${profile.username}`);

    function getHeartbeat() {
      logger.log('info', 'Requesting heartbeat');
      a.Heartbeat((err, hb) => {
        if (err) {
          logger.error(err);
          process.exit(3);
        }

        if (!hb || !hb.cells) {
          logger.error('hb or hb.cells undefined - aborting');
        } else {
          logger.log('info', 'Heartbeat received');
          const encounters = {};
          for (let i = hb.cells.length - 1; i >= 0; i--) {
            if (hb.cells[i].WildPokemon[0]) {
              const wildPokemon = hb.cells[i].WildPokemon;
              for (let j = wildPokemon.length - 1; j >= 0; j--) {
                const pokeId = wildPokemon[j].pokemon.PokemonId;
                const pokemon = a.pokemonlist[parseInt(pokeId) - 1];
                const position = {
                  latitude: wildPokemon[j].Latitude,
                  longitude: wildPokemon[j].Longitude,
                };
                const encounterId = wildPokemon[j].SpawnPointId;
                encounters[encounterId] = {
                  pokemon,
                  details: wildPokemon[j],
                  position
                };
              }
            }
          }
          const hbPokemon = [];
          for (const key in encounters) {
            hbPokemon.push(encounters[key]);
          }
          logger.log('info', `Found ${hbPokemon.length} pokemon`);

          if (hbPokemon.length == 0) {
            return;
          }

          const newPokemon = removeKnownPokemon(hbPokemon);
          logger.log('info', `Found ${newPokemon.length} new pokemon`);
          if (newPokemon.length == 0) {
            return;
          }

          const interestingPokemon = removeUninterestingPokemon(newPokemon);
          logger.log('info', `Found ${interestingPokemon.length} interesting pokemon`);
          if (interestingPokemon.length == 0) {
            return;
          }
          sendMessage(interestingPokemon);
        }
      });
    }
    getHeartbeat();
    setInterval(getHeartbeat, 60000);
  });
});


let knownPokemon = {};
function removeKnownPokemon(pokemon) {
  const nextKnownPokemon = {};
  const unknownPokemon = [];
  for (const id in pokemon) {
    const p = pokemon[id];
    if (!knownPokemon[p.details.SpawnPointId]) {
      unknownPokemon.push(p);
    }
    nextKnownPokemon[p.details.SpawnPointId] = true;
  }
  knownPokemon = nextKnownPokemon;
  return unknownPokemon;
}

function removeUninterestingPokemon(pokemon) {
  const interestingPokemon = [];
  for (const id in pokemon) {
    const p = pokemon[id];
    p.distance = geo.getDistance(p.position, start_location);
    p.bearing = geo.cardinalBearing(geo.getBearing(start_location, p.position));
    if (metrics.shouldReport(p)) {
      interestingPokemon.push(p);
    }
  }
  return interestingPokemon;
}

function sendMessage(pokemon) {
  for (const id in pokemon) {
    postPokemonMessage(pokemon[id]);
  }
}

function postPokemonMessage(p){
  let pre = '';
  if (p.rarity.match(/rare/i)) {
    pre = '@here ';
  }
  geo.reverseGeoCode(p.position, function (geocode) {
    const seconds = Math.floor(p.details.TimeTillHiddenMs / 1000);
    const remaining = `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)}m remaining`;
    const pretext = `${pre} A wild *${p.pokemon.name}* appeared!`;
    const message = `<https://maps.google.co.uk/maps?f=d&dirflg=w&saddr=${start_location.latitude},${start_location.longitude}&daddr=${p.position.latitude},${p.position.longitude}|${p.distance}m ${p.bearing} ${geocode}>\n${remaining}`;

      var COLOUR_BY_RARITY = {
        "common": "#19A643",
        "uncommon": "#1BC4B9",
        "rare": "#1E0BE6",
        "ultra-rare": "#E600FF"
      };

      var attachments = [
        {
          pretext,
          'fallback': pretext + '\n' + message,
          'color': COLOUR_BY_RARITY[p.rarity],
          'image_url': p.pokemon.img,
          'text': message,
          'unfurl_media': true,
          'mrkdwn_in': ['pretext'],
        }
      ];

      if(googleAPI)
      {
        let image = `https://maps.googleapis.com/maps/api/staticmap?center=${p.position.latitude},${p.position.longitude}&size=640x400&style=element:labels|visibility:off&style=element:geometry.stroke|visibility:off&style=feature:landscape|element:geometry|saturation:-100&style=feature:water|saturation:-100|invert_lightness:true&key=${process.env.MAPS_API}&zoom=14&&markers=color:blue%7Clabel:S%7C${p.position.latitude},${p.position.longitude}`;
        attachments = [
              {
                pretext,
                'fallback': pretext + '\n' + message,
                'color': COLOUR_BY_RARITY[p.rarity],
                'image_url': p.pokemon.img,
                'text': message,
                'unfurl_media': true,
                'mrkdwn_in': ['pretext'],
              },
              {
                "title":"Google Image",
                "image_url": image,
                "unfurl_media": true,
                "mrkdwn_in": ["pretext"]
              }
            ];
      }
       if ( slackURL ){
        request.post({
          url: slackURL,
          json: true,
          body: {
            attachments:attachments,
          }
        }, function(error, response, body) {
          if(error) logger.error(error);
          if(response.body) logger.log(response.body);
        });
      }
      logger.log('info', "POST: "+ pretext + '\n' + message );
    });

}
