import Notification from './notification';
import type { NotificationOptions } from '../types';

/**
 * @class BasicNotification
 */
class BasicNotification extends Notification {
  /**
   * @constructor
   * @param {String} deviceToken
   * @param {Message} message
   * @param {Object} [options] - see super class
   */
  constructor(deviceToken: string, message: string, options: NotificationOptions = {}) {
    let mergedOptions = options;
    if (typeof options?.alert === 'string') {
      mergedOptions.alert = options.alert;
    } else {
      mergedOptions.alert = {
        ...options.alert,
        body: message,
      };
    }
    super(deviceToken, options);
  }
}

export default BasicNotification;
