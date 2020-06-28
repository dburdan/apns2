import pushType from './notifications/constants/push-type';

export type ResponseError = {
  error: {
    reason: string;
    statusCode: number;
    notification: Notification;
  };
};

export interface APNSOptions {
  team: string;
  keyId: string;
  signingKey: string;
  defaultTopic?: string | null;
  host?: string;
  port?: number;
  connections?: number;
}

export interface NotificationOptions {
  alert?:
    | string
    | {
        title?: string;
        subtitle?: string;
        body: string;
        'title-loc-key'?: string;
        'title-loc-args'?: string[];
        'subtitle-loc-key'?: string;
        'subtitle-loc-args'?: string[];
        'loc-key'?: string;
        'loc-args'?: string[];
        'action-loc-key'?: string;
        'launch-image'?: string;
      };
  aps?: any;
  badge?: number;
  category?: string;
  collapseId?: string;
  contentAvailable?: boolean;
  data?: { [key: string]: any };
  expiration?: number | Date;
  priority?: number;
  pushType?: keyof typeof pushType;
  sound?: string;
  threadId?: string;
  topic?: string;
}
