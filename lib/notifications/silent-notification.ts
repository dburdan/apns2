import Notification from './notification';
import pushType from './constants/push-type';
import priority from './constants/priority';
import type { NotificationOptions } from '../types';

/**
 * @class SilentNotification
 */
class SilentNotification extends Notification {
  /**
   * @constructor
   * @param {String} deviceToken
   * @param {Object} [options] - see super class
   */
  constructor(deviceToken: string, options: NotificationOptions = {}) {
    super(deviceToken, {
      contentAvailable: true,
      pushType: options.pushType || pushType.background,
      priority: options.priority || priority.throttled,
      badge: options.badge,
      topic: options.topic,
      expiration: options.expiration,
      data: options.data,
    });
  }
}

export default SilentNotification;
