export type RawLead = {
  business_name: string;
  address: string;
  website: string;
  phone: string;
  email: string;
  placeId: string;
  categories: string[];
  businessStatus: string;
};

export type CleanLead = {
  business_name: string;
  address: string;
  website: string;
  phone: string;
  email: string;
};

export type LeadRequest = {
  business_category: string;
  location: string;
  max_results?: number;
};
