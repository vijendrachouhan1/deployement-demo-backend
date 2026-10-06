type User = {
  id: string;
  name: string;
  language: string;
  role: string;
  teams: string[];
  created_at: string;
  updated_at: string;
  banned: boolean;
  online: boolean;
  last_active: string;
  blocked_user_ids: string[];
  shadow_banned: boolean;
  invisible: boolean;
  unread_count?: number;
  unread_threads?: number;
  unread_thread_messages?: number;
  channel_unread_count?: number;
  channel_last_read_at?: string;
  total_unread_count?: number;
  unread_channels?: number;
};

export type Member = {
  user_id: string;
  user: User;
  status: string;
  created_at: string;
  updated_at: string;
  banned: boolean;
  shadow_banned: boolean;
  role: string;
  channel_role: string;
  notifications_muted: boolean;
};

type Attachment =
  | {
      type: "image";
      fallback: string;
      image_url: string;
      thumb_url: string;
    }
  | {
      type: "video";
      fallback: string;
      asset_url: string;
      thumb_url: string;
    }
  | {
      type: "file";
      fallback: string;
      file_url: string;
      mime_type?: string;
      size?: number;
    }
  | {
      type: "audio";
      fallback: string;
      audio_url: string;
      duration?: number; // in seconds
    }
  | {
      type: "link";
      fallback: string;
      title?: string;
      url: string;
      description?: string;
      image_url?: string;
    }
  | {
      type: string; // any other unknown type
      fallback: string;
      [key: string]: any; // capture all extra fields dynamically
    };

export type Message = {
  id: string;
  text: string;
  html: string;
  type: string;
  user: User;
  member: {
    channel_role: string;
  };
  attachments: Attachment[];
  latest_reactions: any[];
  own_reactions: any[];
  reaction_counts: Record<string, number>;
  reaction_scores: Record<string, number>;
  reply_count: number;
  deleted_reply_count: number;
  cid: string;
  created_at: string;
  updated_at: string;
  shadowed: boolean;
  mentioned_users: any[];
  silent: boolean;
  pinned: boolean;
  pinned_at: string | null;
  pinned_by: any;
  pin_expires: any;
  restricted_visibility: any[];
};

type ChannelConfig = {
  created_at: string;
  updated_at: string;
  name: string;
  typing_events: boolean;
  read_events: boolean;
  connect_events: boolean;
  search: boolean;
  reactions: boolean;
  replies: boolean;
  quotes: boolean;
  mutes: boolean;
  uploads: boolean;
  url_enrichment: boolean;
  custom_events: boolean;
  push_notifications: boolean;
  reminders: boolean;
  mark_messages_pending: boolean;
  polls: boolean;
  user_message_reminders: boolean;
  shared_locations: boolean;
  count_messages: boolean;
  message_retention: string;
  max_message_length: number;
  automod: string;
  automod_behavior: string;
  skip_last_msg_update_for_system_msgs: boolean;
  commands: Array<{
    name: string;
    description: string;
    args: string;
    set: string;
  }>;
};

type Channel = {
  id: string;
  type: string;
  cid: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  created_by: User;
  frozen: boolean;
  disabled: boolean;
  members: Member[];
  member_count: number;
  config: ChannelConfig;
  message_count: number;
  name: string;
  distinct: boolean;
};

type RequestType = {
  type: string;
  ip: string;
  user_agent: string;
  sdk: string;
};

export type GetStreamEvent = {
  type: string;
  created_at: string;
  cid: string;
  channel_member_count: number;
  channel_custom: {
    distinct: boolean;
    name: string;
  };
  channel_type: string;
  channel_id: string;
  message_id: string;
  message: Message;
  user: User;
  watcher_count: number;
  channel: Channel;
  members: Member[];
  channel_last_message_at: string;
  request_info: RequestType;
};
