import { useState } from "react";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useTranslation } from "react-i18next";
import { Page } from "../components/page/Page";
import { ResourcesTab } from "./ResourcesTab";

export const Resources = () => {
    const { t } = useTranslation();
    const [activeTabKey, setActiveTabKey] = useState(0);

    return (
        <Page title={t("resources")} description={t("resourceIntroMessage")}>
            <Tabs value={activeTabKey} onChange={(_, value) => setActiveTabKey(value)}>
                <Tab data-testid="myResources" label={t("myResources")} />
                <Tab data-testid="sharedWithMe" label={t("sharedWithMe")} />
            </Tabs>
            {activeTabKey === 0 ? <ResourcesTab /> : <ResourcesTab isShared />}
        </Page>
    );
};

export default Resources;
