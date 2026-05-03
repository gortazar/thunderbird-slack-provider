"use strict";

const FIXTURES = {
  token: 'xoxb-test-token-1234',

  authTest: {
    ok: true,
    team: 'Test Workspace',
    user: 'testuser',
    user_id: 'U123',
    team_id: 'T123',
  },

  channels: [
    { id: 'C001', name: 'general', is_member: true, is_private: false, unread_count: 0 },
    { id: 'C002', name: 'random', is_member: true, is_private: false, unread_count: 2 },
    { id: 'C003', name: 'private-stuff', is_member: true, is_private: true, unread_count: 0 },
    { id: 'C004', name: 'not-joined', is_member: false, is_private: false, unread_count: 0 },
  ],

  messages: [
    { ts: '1700000001.000100', user: 'U001', text: 'Hello world', type: 'message' },
    { ts: '1700000002.000200', user: 'U002', text: '*bold* and _italic_', type: 'message' },
    {
      ts: '1700000003.000300',
      user: 'U001',
      text: '',
      type: 'message',
      subtype: 'channel_join',
    },
    {
      ts: '1700000004.000400',
      user: 'U003',
      text: 'Check <https://example.com|this link>',
      type: 'message',
      reply_count: 2,
    },
  ],

  user: {
    id: 'U001',
    name: 'john.doe',
    real_name: 'John Doe',
    profile: {
      display_name: 'johndoe',
      image_48: 'https://example.com/avatar.png',
    },
  },

  sentMessage: {
    ts: '1700000099.000000',
    text: 'New message',
    user: 'U001',
  },
};

module.exports = FIXTURES;
