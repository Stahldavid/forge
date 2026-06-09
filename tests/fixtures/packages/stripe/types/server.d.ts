export declare function constructEvent(
  payload: string | Buffer,
  signature: string,
  secret: string,
): Event;

export interface Event {
  id: string;
  type: string;
}
