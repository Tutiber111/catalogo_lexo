export const dashboardOwnerId='094aa67d-7768-4277-85c9-1d1b1831e7fe';
export const canAccessDashboard=user=>Boolean(user&&user.id===dashboardOwnerId);
