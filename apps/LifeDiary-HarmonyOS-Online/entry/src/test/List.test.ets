import localUnitTest from './LocalUnit.test';
import nativeStoreTest from './NativeStore.test';

export default function testsuite() {
  localUnitTest();
  nativeStoreTest();
}
