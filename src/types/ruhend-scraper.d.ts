declare module "ruhend-scraper" {
  export interface IgdlMedia {
    url?: string;
    type?: string;
  }
  export function igdl(url: string): Promise<{ data?: IgdlMedia[] }>;
}
