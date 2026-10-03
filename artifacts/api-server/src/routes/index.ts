import { Router, type IRouter } from "express";
import accessRouter from "./access";
import chatRouter from "./chat";
import dispatchRouter from "./dispatch";
import installationRouter from "./installation";
import healthRouter from "./health";
import measurementDatabaseRouter from "./measurement-database";
import orderHubRouter from "./order-hub";
import orderWorkspaceRouter from "./order-workspace";
import quotationApprovalsRouter from "./quotation-approvals";
import quotationsRouter from "./quotations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(chatRouter);
router.use(dispatchRouter);
router.use(installationRouter);
router.use(orderHubRouter);
router.use(orderWorkspaceRouter);
router.use(measurementDatabaseRouter);
router.use(quotationApprovalsRouter);
router.use(quotationsRouter);

export default router;
