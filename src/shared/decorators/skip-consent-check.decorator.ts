import { SetMetadata } from '@nestjs/common';
import { SKIP_CONSENT_CHECK_KEY } from '../guards/consents.guard';

export const SkipConsentCheck = () => SetMetadata(SKIP_CONSENT_CHECK_KEY, true);
