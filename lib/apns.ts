import { EventEmitter } from 'events';
import { Pool } from 'tarn';
import jwt from 'jsonwebtoken';
import Http2Client, { HTTPClientOptions } from './http2-client';
import Errors from './errors';
import Notification, { NotificationPayload } from './notifications/notification';
import BasicNotification from './notifications/basic-notification';
import SilentNotification from './notifications/silent-notification';
import type { APNSOptions, ResponseError } from './types';

type Response = { notification: NotificationPayload; deviceToken: string } | ResponseError;

/**
 * @const
 * @desc APNS version
 */
const API_VERSION = 3;

/**
 * @const
 * @desc Number of connections to open up with apns API
 */
const MAX_CONNECTIONS = 10;

/**
 * @const
 * @desc Default host to send request
 */
const HOST = `api.push.apple.com`;

/**
 * @const
 * @desc Default port to send request
 */
const PORT = 443;

/**
 * @const
 * @desc Signing algorithm for JSON web token
 */
const SIGNING_ALGORITHM = `ES256`;

/**
 * @const
 * @desc Reset our signing token every 55 minutes as reccomended by Apple
 */
const RESET_TOKEN_INTERVAL = 55 * 60 * 1000;

/**
 * @class APNS
 */
class APNS extends EventEmitter {
  private _token: string | null;
  private _team: APNSOptions['team'];
  private _keyId: APNSOptions['keyId'];
  private _signingKey: APNSOptions['signingKey'];
  private _defaultTopic: APNSOptions['defaultTopic'];
  private _clients: Pool<Http2Client>;
  private _interval: NodeJS.Timeout;

  /**
   * @constructor
   * @param {Object} options
   * @param {String} [options.team]
   * @param {String} [options.signingKey]
   * @param {String} [options.key]
   * @param {String} [options.host]
   * @param {Int} [options.port]
   * @param {Int} [options.connections]
   */
  constructor({
    team,
    keyId,
    signingKey,
    defaultTopic = null,
    host = HOST,
    port = PORT,
    connections = MAX_CONNECTIONS,
  }: APNSOptions) {
    if (!team) throw new Error(`team is required`);
    if (!keyId) throw new Error(`keyId is required`);
    if (!signingKey) throw new Error(`signingKey is required`);
    super();
    this._token = null;
    this._team = team;
    this._keyId = keyId;
    this._signingKey = signingKey;
    this._defaultTopic = defaultTopic;
    this._clients = this._createClientPool({ host, port, connections });
    this._interval = setInterval(() => this._resetSigningToken(), RESET_TOKEN_INTERVAL).unref();
    this.on(Errors.expiredProviderToken, () => this._resetSigningToken());
  }

  /**
   * @method send
   * @param {Notification} notifications
   * @return {Promise}
   */
  async send(deviceToken: string, notification: NotificationPayload): Promise<Response> {
    return this._sendOne(deviceToken, notification);
  }

  /**
   * @method sendMany
   * @param {Array<Notification>} notifications
   * @return {Promise}
   */
  async sendMany(notifications: Notification[]): Promise<Response[]> {
    let promises = notifications.map(async (notification) => {
      try {
        return await this._sendOne(notification.deviceToken, notification);
      } catch (error) {
        return { error };
      }
    });
    return Promise.all(promises);
  }

  /**
   * @method sendToMany
   * @param {Array<string>} deviceTokens
   * @param {Notification} notification
   * @return {Promise}
   */
  async sendToMany(deviceTokens: string[], notification: NotificationPayload): Promise<Response[]> {
    const promises = deviceTokens.map(async (device) => {
      try {
        return await this._sendOne(device, notification);
      } catch (error) {
        return { error };
      }
    });
    return Promise.all(promises);
  }

  /**
   * @method destroy
   * @return {Promise}
   */
  async destroy() {
    return this._clients.destroy();
  }

  /**
   * @private
   * @method _sendOne
   * @param {string} deviceToken
   * @param {Notification} notification
   * @return {Promise}
   */
  async _sendOne(deviceToken: string, notification: NotificationPayload): Promise<Response> {
    let options: HTTPClientOptions = {
      path: `/${API_VERSION}/device/${encodeURIComponent(deviceToken)}`,
      headers: {
        authorization: `bearer ${this._getSigningToken()}`,
        'apns-push-type': notification.pushType,
        'apns-priority': notification.priority,
        'apns-topic': notification.topic || this._defaultTopic,
      },
    };

    if (notification.expiration) {
      options.headers!['apns-expiration'] =
        notification.expiration instanceof Date
          ? notification.expiration.getTime() / 1000
          : notification.expiration;
    }

    if (notification.collapseId) {
      options.headers!['apns-collapse-id'] = notification.collapseId;
    }

    let client = await this._acquireClient();
    this._releaseClient(client);

    let body = JSON.stringify(notification.APNSOptions());
    let res = await client.post(options, body);
    return this._handleServerResponse(res, deviceToken, notification);
  }

  /**
   * @private
   * @method _createClientPool
   * @param {String} host
   * @param {Number} port
   * @return {Pool}
   */
  _createClientPool({
    host,
    port,
    connections,
  }: {
    host: string;
    port: number;
    connections: number;
  }) {
    return new Pool<Http2Client>({
      create: () => new Http2Client(host, port).connect(),
      validate: (client) => client.ready || false,
      destroy: (client) => client.destroy(),
      min: 0,
      max: connections,
    });
  }

  /**
   * @private
   * @method _acquireClient
   * @return {Promise}
   */
  async _acquireClient() {
    return this._clients.acquire().promise;
  }

  /**
   * @private
   * @method _acquireClient
   * @return {Promise}
   */
  _releaseClient(client: Http2Client) {
    return this._clients.release(client);
  }

  /**
   * @private
   * @method _handleServerResponse
   * @param {ServerResponse} res
   * @param {string} deviceToken
   * @param {NotificationPayload} notification
   * @return {Promise}
   */
  async _handleServerResponse(
    res: any,
    deviceToken: string,
    notification: NotificationPayload,
  ): Promise<Response> {
    if (res.statusCode === 200) {
      return {
        notification,
        deviceToken,
      };
    }

    let json: ResponseError['error'];

    try {
      json = JSON.parse(res.body);
    } catch (err) {
      json = { reason: Errors.unknownError } as ResponseError['error'];
    }

    json.statusCode = res.statusCode;
    json.notification = notification;

    this.emit(json.reason, json);
    this.emit(Errors.error, json);

    throw json;
  }

  /**
   * @private
   * @method _getSigningToken
   * @return {String}
   */
  _getSigningToken() {
    if (this._token) {
      return this._token;
    }

    let claims = {
      iss: this._team,
      iat: Date.now() / 1000,
    };

    let key = this._signingKey;

    let options: jwt.SignOptions = {
      algorithm: SIGNING_ALGORITHM,
      header: {
        alg: SIGNING_ALGORITHM,
        kid: this._keyId,
      },
    };

    let token: string | null;

    try {
      token = jwt.sign(claims, key, options);
    } catch (err) {
      token = null;
      this.emit(Errors.invalidSigningKey);
    }

    this._token = token;

    return token;
  }

  /**
   * @private
   * @method _resetSigningToken
   */
  _resetSigningToken() {
    this._token = null;
    return this._getSigningToken();
  }
}

export default {
  APNS,
  Errors,
  Notification,
  BasicNotification,
  SilentNotification,
};
