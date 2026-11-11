import { observed } from '@/lib/review/manual';
import { changeTeamAccess, effectiveAccount } from '@/lib/demo-login';
import { demoAccounts, validPermissions } from '@/lib/demo-permissions';
import { demoEnabled, workspaceId } from '@/lib/demo-session';
import { authorized, denied } from '@/lib/server-auth';

function canManage(request: Request) {
  return demoEnabled() && authorized(request, 'operator');
}
function members(workspace: string) {
  return demoAccounts.filter(identity => identity.role !== 'Owner').map(identity => effectiveAccount(workspace, identity));
}
export function GET(request: Request) {
  if (!canManage(request)) return denied(request);
  return Response.json({ members: members(workspaceId(request)!) });
}
async function handlePUT(request: Request) {
  if (!canManage(request)) return denied(request);
  const edit = await request.json().catch(() => null);
  if (!edit || typeof edit !== 'object' || !('id' in edit) || !('role' in edit) || !('permissions' in edit))
    return Response.json({ error: 'A member, role and permissions are required.' }, { status: 400 });
  const identity = demoAccounts.find(member => member.id === edit.id && member.role !== 'Owner');
  if (!identity || (edit.role !== 'Employee' && edit.role !== 'Administrator') || !validPermissions(edit.permissions))
    return Response.json({ error: 'Choose a team member and valid access settings.' }, { status: 400 });
  if (!canManage(request)) return denied(request);
  const workspace = workspaceId(request)!;
  changeTeamAccess(workspace, identity.id, edit.role, edit.permissions);
  return Response.json({ members: members(workspace) });
}

export function PUT(req:Request){return observed(req, handlePUT);}
