import { createRequire as __snowlumaCreateRequire } from "node:module";
__snowlumaCreateRequire(import.meta.url);
import { t as __exportAll } from "./rolldown-runtime-DpvAeRoy.js";
//#region ../onebot/src/network/quick-operation.ts
var quick_operation_exports = /* @__PURE__ */ __exportAll({ executeQuickOperation: () => executeQuickOperation });
async function executeQuickOperation(event, operation, api) {
	const postType = event.post_type;
	if (postType === "message") {
		if (operation.reply !== void 0 && operation.reply !== null && operation.reply !== "") {
			const messageType = event.message_type;
			const autoEscape = !!operation.auto_escape;
			if (messageType === "group") {
				const params = {
					group_id: event.group_id,
					message: operation.reply,
					auto_escape: autoEscape
				};
				if (operation.at_sender !== false && event.user_id) {
					const atSegment = {
						type: "at",
						data: { qq: String(event.user_id) }
					};
					if (typeof operation.reply === "string") {
						params.message = [atSegment, {
							type: "text",
							data: { text: operation.reply }
						}];
						params.auto_escape = false;
					} else if (Array.isArray(operation.reply)) params.message = [atSegment, ...operation.reply];
				}
				await api.handle("send_group_msg", params);
			} else if (messageType === "private") await api.handle("send_private_msg", {
				user_id: event.user_id,
				message: operation.reply,
				auto_escape: autoEscape
			});
		}
		if (operation.delete) await api.handle("delete_msg", { message_id: event.message_id });
		if (operation.ban && event.message_type === "group") {
			const duration = typeof operation.ban_duration === "number" ? operation.ban_duration : 1800;
			await api.handle("set_group_ban", {
				group_id: event.group_id,
				user_id: event.user_id,
				duration
			});
		}
		if (operation.kick && event.message_type === "group") await api.handle("set_group_kick", {
			group_id: event.group_id,
			user_id: event.user_id,
			reject_add_request: !!operation.reject_add_request
		});
	}
	if (postType === "request") {
		if (operation.approve !== void 0) {
			const requestType = event.request_type;
			if (requestType === "friend") await api.handle("set_friend_add_request", {
				flag: event.flag,
				approve: operation.approve,
				remark: operation.remark ?? ""
			});
			else if (requestType === "group") await api.handle("set_group_add_request", {
				flag: event.flag,
				sub_type: event.sub_type,
				approve: operation.approve,
				reason: operation.reason ?? ""
			});
		}
	}
}
//#endregion
export { quick_operation_exports as n, executeQuickOperation as t };
