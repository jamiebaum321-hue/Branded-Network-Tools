import { createHmac } from 'node:crypto';
export const invitationToken = (secret, messageId) =>
  createHmac('sha256', secret).update('branded-team-invite/'+messageId).digest('base64url');
