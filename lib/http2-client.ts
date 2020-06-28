import { URL } from 'url';
import http2 from 'http2';

export type HTTPClientOptions = {
  method?: string;
  path: string;
  headers?: { [key: string]: any };
};
type Body = string | null;

type ServerResponse = {
  statusCode: string;
  headers: HTTPClientOptions['headers'];
  body: Body;
};

// Check to make sure this is the native http2
if (!http2.constants || !http2.constants.NGHTTP2_SESSION_CLIENT) {
  throw new Error('Invalid http2 library, must be running Node v10.16 or later');
}

const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_STATUS,
  NGHTTP2_CANCEL,
} = http2.constants;

/**
 * @class HTTP2Client
 */
class HTTP2Client {
  private _url: URL;
  private _timeout: number;
  private _ready: boolean;
  private _session?: http2.ClientHttp2Session;

  /**
   * @constructor
   */
  constructor(host: string, port = 443, { timeout = 5000 } = {}) {
    if (!host) throw new Error('host is required');
    this._url = new URL(`https://${host}:${port}`);
    this._timeout = timeout;
    this._ready = false;
    this._session = undefined;
  }

  /**
   * @param {Boolean} ready
   */
  get ready() {
    return this._ready && this._session && !this._session.destroyed;
  }

  /**
   * @param {Http2Session}
   */
  get session() {
    return this._session;
  }

  /**
   * @method connect
   * @return {Promise}
   */
  async connect(): Promise<HTTP2Client> {
    return new Promise((resolve, reject) => {
      let session = http2.connect(this._url);
      session.once('error', reject);
      session.once('socketError', reject);
      session.once('connect', () => {
        this._connected(session);
        resolve(this);
      });
    });
  }

  /**
   * @method destroy
   */
  destroy() {
    if (this._session && !this._session.destroyed) {
      this._session.destroy();
    }
    this._ready = false;
    this._session = undefined;
  }

  /**
   * @method get
   */
  async get(options: HTTPClientOptions) {
    options.method = `GET`;
    return this.request(options);
  }

  /**
   * @method post
   */
  async post(options: HTTPClientOptions, body: Body) {
    options.method = `POST`;
    return this.request(options, body);
  }

  /**
   * @method put
   */
  async put(options: HTTPClientOptions, body: Body) {
    options.method = `PUT`;
    return this.request(options, body);
  }

  /**
   * @method delete
   */
  async delete(options: HTTPClientOptions) {
    options.method = `DELETE`;
    return this.request(options);
  }

  /**
   * @method request
   * @param {Object} options
   * @param {String} options.method
   * @param {String} options.host
   * @param {String|Buffer} [body]
   * @return {Promise<ServerResponse>}
   */
  async request(
    { method, path, headers = {} }: HTTPClientOptions,
    body: Body = null,
  ): Promise<ServerResponse> {
    if (!method) throw new Error('method is required');
    if (!path) throw new Error('path is required');
    if (!this._session) throw new Error('Must call connect() before making a request');

    return new Promise((resolve, reject) => {
      headers[HTTP2_HEADER_METHOD] = method;
      headers[HTTP2_HEADER_PATH] = path;

      let req = this._session!.request(headers);

      // Cancel request after timeout
      req.setTimeout(this._timeout, () => req.close(NGHTTP2_CANCEL));

      // Response handling
      req.on('response', (headers) => {
        let body = '';

        req.on('data', (chunk) => (body += chunk));

        const headerStatus = headers[HTTP2_HEADER_STATUS];
        req.on('end', () => {
          resolve({
            statusCode: Array.isArray(headerStatus) ? headerStatus[0] : headerStatus || '400',
            headers,
            body,
          });
        });
      });

      // Error handling
      req.on('error', reject);
      req.on('timeout', () => reject(new Error(`http2: timeout connecting to ${this._url}`)));

      // Post body
      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * @private
   * @method _connected
   * @param {Http2Session} session
   */
  _connected(session: http2.ClientHttp2Session) {
    session.on('close', () => this.destroy());
    session.on('frameError', () => this.destroy());
    session.on('goaway', () => this.destroy());
    session.on('socketError', () => this.destroy());
    session.on('timeout', () => this.destroy());
    this._session = session;
    this._ready = true;
  }
}

export default HTTP2Client;
