declare module "ruhend-scraper" {
  export interface IgdlMedia {
    url?: string;
    type?: string;
  }
  export function igdl(url: string): Promise<{ data?: IgdlMedia[] }>;
  export function igdl2(url: string): Promise<{ data?: IgdlMedia[] }>;
}
