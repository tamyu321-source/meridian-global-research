import { MeridianApp } from "@/components/meridian-app";
export default async function Page({params}:{params:Promise<{instrumentId:string}>}){const {instrumentId}=await params;return <MeridianApp view="security" instrumentId={decodeURIComponent(instrumentId)}/>;}
