import {
  PlatformInfo,
  Attribute,
  MessageDeletionMode,
} from '@textshq/platform-sdk'
import { PLATFORM_ICON } from './icons'


const info: PlatformInfo = {
  name: 'ai-playground',
  version: '1.0.0',
  displayName: 'AI Playground',
  icon: PLATFORM_ICON,
  loginMode: 'custom',
  deletionMode: MessageDeletionMode.UNSUPPORTED,
  attributes: new Set([
    Attribute.NO_SUPPORT_GROUP_THREAD_CREATION,
    // Attribute.NO_SUPPORT_SINGLE_THREAD_CREATION,
    Attribute.NO_SUPPORT_TYPING_INDICATOR,
    Attribute.CANNOT_MESSAGE_SELF,
  ]),
  attachments: {
    noSupport: true,
  },
}

export default info
