import localUnitTest from './LocalUnit.test';
import offlinePrivacyTest from './OfflinePrivacy.test';

export default function testsuite() {
  localUnitTest();
  offlinePrivacyTest();
}
