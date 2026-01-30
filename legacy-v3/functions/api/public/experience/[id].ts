import { Env, json } from "../../_util";

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const exp = await env.DB.prepare(
    "SELECT e.*, t.mindar_target_file_r2_key FROM experiences e JOIN targets t ON e.target_id=t.id WHERE e.id=?"
  ).bind(params!.id).first<any>();

  return json({
    videoUrl: exp.video_url,
    mindarTargetUrl: `${env.R2_PUBLIC_BASE}/${exp.mindar_target_file_r2_key}`
  });
};
