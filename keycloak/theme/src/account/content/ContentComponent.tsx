import { lazy, Suspense, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { useParams } from "react-router-dom";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { MenuItem } from "../root/PageNav";
import type { ContentComponentParams } from "../routes";
import { joinPath } from "../utils/joinPath";
import { usePromise } from "../utils/usePromise";
import fetchContentJson from "./fetchContent";

function findComponent(content: MenuItem[], componentId: string): string | undefined {
    for (const item of content) {
        if ("path" in item && item.path.endsWith(componentId) && "modulePath" in item) {
            return item.modulePath;
        }
        if ("children" in item) {
            const found = findComponent(item.children, componentId);
            if (found) return found;
        }
    }
    return undefined;
}

export const ContentComponent = () => {
    const context = useEnvironment();
    const [content, setContent] = useState<MenuItem[]>();
    const { componentId } = useParams<ContentComponentParams>();

    usePromise(signal => fetchContentJson({ signal, context }), setContent);
    const modulePath = useMemo(() => findComponent(content || [], componentId!), [content, componentId]);

    return modulePath ? <Component modulePath={modulePath} /> : null;
};

const Component = ({ modulePath }: { modulePath: string }) => {
    const { environment } = useEnvironment();
    const Element = lazy(() => import(/* @vite-ignore */ joinPath(environment.resourceUrl, modulePath)));
    return (
        <Suspense fallback={<CircularProgress />}>
            <Element />
        </Suspense>
    );
};

export default ContentComponent;
