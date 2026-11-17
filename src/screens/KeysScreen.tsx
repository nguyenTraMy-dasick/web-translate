import { useT } from '../i18n';
import { Page, Title } from '../ui/common';
import KeysPanel from './KeysPanel';

export default function KeysScreen() {
  const { t } = useT();
  return (
    <Page>
      <Title title={t('keys.title')} sub={t('keys.sub')} />
      <KeysPanel />
    </Page>
  );
}
