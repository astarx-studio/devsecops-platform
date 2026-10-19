import { useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { getLinkedAccounts, type LinkedAccountQueryParams } from "../api/methods";
import type { LinkedAccountRepresentation } from "../api/representations";
import { Page } from "../components/page/Page";
import { usePromise } from "../utils/usePromise";
import { AccountRow } from "./AccountRow";
import { LinkedAccountsToolbar } from "./LinkedAccountsToolbar";

export const LinkedAccounts = () => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountRepresentation[]>([]);
    const [unlinkedAccounts, setUnlinkedAccounts] = useState<LinkedAccountRepresentation[]>([]);
    const [paramsUnlinked, setParamsUnlinked] = useState<LinkedAccountQueryParams>({ first: 0, max: 6, linked: false });
    const [paramsLinked, setParamsLinked] = useState<LinkedAccountQueryParams>({ first: 0, max: 6, linked: true });
    const [key, setKey] = useState(1);
    const refresh = () => setKey(current => current + 1);

    usePromise(signal => getLinkedAccounts({ signal, context }, paramsUnlinked), setUnlinkedAccounts, [paramsUnlinked, key]);
    usePromise(signal => getLinkedAccounts({ signal, context }, paramsLinked), setLinkedAccounts, [paramsLinked, key]);

    return (
        <Page title={t("linkedAccounts")} description={t("linkedAccountsIntroMessage")}>
            <Stack spacing={4}>
                <section>
                    <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                        {t("linkedLoginProviders")}
                    </Typography>
                    <LinkedAccountsToolbar
                        onFilter={search => setParamsLinked({ ...paramsLinked, first: 0, search })}
                        count={linkedAccounts.length}
                        first={paramsLinked.first}
                        max={paramsLinked.max}
                        hasNext={linkedAccounts.length > paramsLinked.max - 1}
                        onNextClick={() => setParamsLinked({ ...paramsLinked, first: paramsLinked.first + paramsLinked.max - 1 })}
                        onPreviousClick={() => setParamsLinked({ ...paramsLinked, first: paramsLinked.first - paramsLinked.max + 1 })}
                        onPerPageSelect={(first, max) => setParamsLinked({ ...paramsLinked, first, max })}
                    />
                    {linkedAccounts.filter((_, index) => index !== paramsLinked.max - 1).length === 0 && (
                        <Typography color="text.secondary">{t("linkedEmpty")}</Typography>
                    )}
                    {linkedAccounts.map(
                        (account, index) =>
                            index !== paramsLinked.max - 1 && (
                                <AccountRow key={account.providerName} account={account} isLinked refresh={refresh} />
                            )
                    )}
                </section>
                <section>
                    <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                        {t("unlinkedLoginProviders")}
                    </Typography>
                    <LinkedAccountsToolbar
                        onFilter={search => setParamsUnlinked({ ...paramsUnlinked, first: 0, search })}
                        count={unlinkedAccounts.length}
                        first={paramsUnlinked.first}
                        max={paramsUnlinked.max}
                        hasNext={unlinkedAccounts.length > paramsUnlinked.max - 1}
                        onNextClick={() => setParamsUnlinked({ ...paramsUnlinked, first: paramsUnlinked.first + paramsUnlinked.max - 1 })}
                        onPreviousClick={() => setParamsUnlinked({ ...paramsUnlinked, first: paramsUnlinked.first - paramsUnlinked.max + 1 })}
                        onPerPageSelect={(first, max) => setParamsUnlinked({ ...paramsUnlinked, first, max })}
                    />
                    {unlinkedAccounts.filter((_, index) => index !== paramsUnlinked.max - 1).length === 0 && (
                        <Typography color="text.secondary">{t("unlinkedEmpty")}</Typography>
                    )}
                    {unlinkedAccounts.map(
                        (account, index) =>
                            index !== paramsUnlinked.max - 1 && <AccountRow key={account.providerName} account={account} refresh={refresh} />
                    )}
                </section>
            </Stack>
        </Page>
    );
};

export default LinkedAccounts;
