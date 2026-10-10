import { Router, type IRouter } from "express";
import accessRouter from "./access";
import chatRouter from "./chat";
import dispatchRouter from "./dispatch";
import installationRouter from "./installation";
import installationTeamsRouter from "./installation-teams";
import healthRouter from "./health";
import measurementDatabaseRouter from "./measurement-database";
import orderHubRouter from "./order-hub";
import orderWorkspaceRouter from "./order-workspace";
import quotationApprovalsRouter from "./quotation-approvals";
import quotationWorkflowRouter from "./quotation-workflow";
import quotationsRouter from "./quotations";
import notificationsRouter from "./notifications";
import operationsDashboardRouter from "./operations-dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(operationsDashboardRouter);
router.use(chatRouter);
router.use(dispatchRouter);
router.use(installationRouter);
router.use(installationTeamsRouter);
router.use(orderHubRouter);
router.use(orderWorkspaceRouter);
router.use(measurementDatabaseRouter);
router.use(quotationApprovalsRouter);
router.use(quotationsRouter);
router.use(quotationWorkflowRouter);
router.use(notificationsRouter);

export default router;
