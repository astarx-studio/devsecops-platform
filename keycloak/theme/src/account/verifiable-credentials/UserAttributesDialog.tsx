import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { useTranslation } from "react-i18next";

export const UserAttributesDialog = ({
    credentialScopeName,
    userAttributes,
    onClose
}: {
    credentialScopeName: string;
    userAttributes: Record<string, string[]>;
    onClose: () => void;
}) => {
    const { t } = useTranslation();

    return (
        <Dialog open onClose={onClose} fullWidth>
            <DialogTitle>{t("credentialUserAttributesFor", { credentialScopeName })}</DialogTitle>
            <DialogContent>
                <Table size="small" aria-label={t("credentialUserAttributes")}>
                    <TableHead>
                        <TableRow>
                            <TableCell>{t("credentialAttributeName")}</TableCell>
                            <TableCell>{t("credentialAttributeValue")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {Object.entries(userAttributes).map(([key, values]) => (
                            <TableRow key={key}>
                                <TableCell>{key}</TableCell>
                                <TableCell>{values.join(", ")}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t("close")}</Button>
            </DialogActions>
        </Dialog>
    );
};
