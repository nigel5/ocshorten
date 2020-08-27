const { Client } = require('cassandra-driver');
const { RedisClient } = require('redis');

/**
 * Inject from_url and to_url to headers
 * @param {Client} cassandraClient Client to execute commands on
 * @param {RedisClient} redisClient Client to execute cache commands on
 */
module.exports.withMapping = function (cassandraClient, redisClient) {
  const router = require('express').Router();
  const statements = require('../util/database/statements');
  const settings = require('../ocshorten.conf.json');

  /**
   * Return the key if it already exists for this destination
   * @param {string} fromUrl The short url
   */
  async function getExistingMappingKey(toUrl) {
    try {
      let result = await cassandraClient.execute(
        statements.SELECT_URL_MAPPING_FROM_DEST_URL,
        [toUrl]
      );

      if (result.rowLength < 1) {
        return false;
      }

      result = result.first();
      return result.from_key;
    } catch (e) {
      console.log('Error in getExistingShortUrl', e);
      return false;
    }
  }

  router.get('/api/v1/url', async function (req, res, next) {
    // Cached
    if (req.existingMapping) {
      return next();
    }

    // TODO if not cached then add to ache
    const originalUrl = req.query.q;

    if (originalUrl) {
      const a = await getExistingMappingKey(originalUrl);

      if (a) {
        req.existingMapping = {
          fromUrl: `${settings.base_url}/${a}`,
          toUrl: originalUrl,
        };
      } else {
        req.existingMapping = false;
      }
    }

    next();
  });

  router.get('/:key', async function (req, res, next) {
    const letters = req.params.key;

    // Cached
    if (req.existingMapping) {
      return next();
    }

    try {
      let result = await cassandraClient.execute(
        statements.SELECT_URL_MAPPING_FROM_KEY,
        [letters]
      );

      if (result.rowLength < 1) {
        req.existingMapping = false;
        return next();
      }

      result = result.first();

      req.existingMapping = {
        fromUrl: result.from_url,
        toUrl: result.to_url,
      };

      // Add to cache / extend time
      redisClient.set(letters, result.to_url, 'EX', settings.redis.expireTime);
    } catch (e) {
      console.log('Error in withMapping, /*', e);
      req.existingMapping = false;
      return next();
    }

    next();
  });

  return router;
};
